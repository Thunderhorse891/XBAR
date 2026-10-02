-- Account deletion is decided at the database, not between two API calls
-- (audit F03).
--
-- The race: /api/account-delete checked that each workspace the account owns
-- had no other member, then asked Supabase Auth to delete the account. The
-- owner foreign key cascades that delete into every owned workspace. An
-- invitation accepted between the check and the delete was destroyed with the
-- workspace -- someone else's access and records -- and the request reported
-- success. Re-reading membership just before the delete narrowed the window;
-- it could not close it, because the check and the delete are separate
-- requests and nothing held the workspace still in between.
--
-- The fix is a hold, placed under the same per-workspace advisory lock the
-- seat trigger takes (20261002090000):
--
--   * xbar_hold_owned_workspaces_for_deletion(user) locks each owned
--     workspace in turn and refuses if any has another active member. When all
--     are private it records a hold on each, in the same transaction.
--   * A trigger on workspace_memberships and workspace_invitations takes the
--     same lock and refuses a new active member or pending invitation for a
--     held workspace. Acceptance and deletion now serialize on that lock, so
--     exactly one of them wins: either the member is there before the hold
--     (and deletion is refused), or the hold is there first (and the
--     acceptance is refused with a reason).
--   * xbar_release_account_deletion_holds(user) lifts them if the auth delete
--     fails, so a failed deletion leaves the account and its workspaces as
--     they were.
--   * A hold is honoured for 15 minutes. A request that dies between hold and
--     delete cannot leave a ranch permanently closed to new members.
--   * Holds cascade away with the workspace when the account delete succeeds.
--
-- account_deletion_receipts is the durable record the audit asked for: it is
-- keyed by the user id with NO foreign key, so it outlives the account and
-- records what was deleted and which stored files, if any, could not be
-- removed -- so cleanup that failed stays visible and can be finished.
--
-- Additive only: two new tables (RLS on, no policies, no grants to clients),
-- three functions executable by service_role alone, and two new triggers.
-- No existing row, policy or function is changed.

create table if not exists public.account_deletion_holds (
  workspace_id uuid primary key references public.workspaces (id) on delete cascade,
  user_id uuid not null,
  created_at timestamptz not null default now()
);
alter table public.account_deletion_holds enable row level security;
revoke all on table public.account_deletion_holds from anon, authenticated;

create table if not exists public.account_deletion_receipts (
  id uuid primary key default gen_random_uuid(),
  -- Deliberately no foreign key: the receipt must survive the account.
  user_id uuid not null,
  status text not null default 'pending'
    check (status in ('pending', 'refused', 'failed', 'complete', 'storage_incomplete')),
  held_workspaces uuid[] not null default '{}',
  storage_leftovers jsonb not null default '[]'::jsonb,
  failure text not null default '',
  requested_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.account_deletion_receipts enable row level security;
revoke all on table public.account_deletion_receipts from anon, authenticated;
create index if not exists account_deletion_receipts_user_idx
  on public.account_deletion_receipts (user_id, requested_at desc);

create or replace function public.xbar_hold_owned_workspaces_for_deletion(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  workspace_row record;
  shared uuid[] := '{}';
  held uuid[] := '{}';
begin
  if p_user_id is null then
    raise exception 'A user id is required.';
  end if;

  -- Ordered, so two holds can never wait on each other's locks.
  for workspace_row in
    select id from public.workspaces where owner_user_id = p_user_id order by id
  loop
    perform pg_advisory_xact_lock(hashtextextended('xbar-seats:' || workspace_row.id::text, 0));
    -- `is distinct from`, not `<>`: an active membership whose user_id is NULL
    -- belongs to nobody identifiable, which is evidence of sharing.
    if exists (
      select 1 from public.workspace_memberships m
      where m.workspace_id = workspace_row.id
        and m.status = 'active'
        and m.user_id is distinct from p_user_id
    ) then
      shared := shared || workspace_row.id;
    else
      held := held || workspace_row.id;
    end if;
  end loop;

  if cardinality(shared) > 0 then
    return jsonb_build_object('ok', false, 'shared', to_jsonb(shared), 'held', '[]'::jsonb);
  end if;

  insert into public.account_deletion_holds (workspace_id, user_id, created_at)
  select workspace_id, p_user_id, now() from unnest(held) as workspace_id
  on conflict (workspace_id) do update
    set user_id = excluded.user_id, created_at = excluded.created_at;

  return jsonb_build_object('ok', true, 'shared', '[]'::jsonb, 'held', to_jsonb(held));
end;
$$;

create or replace function public.xbar_release_account_deletion_holds(p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  released integer;
begin
  delete from public.account_deletion_holds where user_id = p_user_id;
  get diagnostics released = row_count;
  return released;
end;
$$;

create or replace function public.xbar_refuse_access_during_account_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  held_by uuid;
begin
  if TG_TABLE_NAME = 'workspace_memberships' then
    if lower(coalesce(new.status, 'active')) <> 'active' then return new; end if;
  elsif lower(coalesce(new.status, 'pending')) <> 'pending' then
    return new;
  end if;

  -- The seat trigger's lock: a hold and an acceptance cannot interleave.
  perform pg_advisory_xact_lock(hashtextextended('xbar-seats:' || new.workspace_id::text, 0));
  select h.user_id into held_by
  from public.account_deletion_holds h
  where h.workspace_id = new.workspace_id
    and h.created_at > now() - interval '15 minutes';
  if not found then return new; end if;

  -- The departing owner's own membership row is not a new member. Read
  -- through to_jsonb because an invitation row has no user_id column, and
  -- PL/pgSQL resolves `new.user_id` against the actual row type.
  if TG_TABLE_NAME = 'workspace_memberships' and (to_jsonb(new) ->> 'user_id')::uuid = held_by then
    return new;
  end if;

  raise exception 'This ranch is being closed by its owner and cannot take new members.';
end;
$$;

create or replace trigger trg_workspace_memberships_refuse_during_deletion
before insert or update on public.workspace_memberships
for each row execute function public.xbar_refuse_access_during_account_deletion();

create or replace trigger trg_workspace_invitations_refuse_during_deletion
before insert or update on public.workspace_invitations
for each row execute function public.xbar_refuse_access_during_account_deletion();

revoke all on function public.xbar_hold_owned_workspaces_for_deletion(uuid) from public, anon, authenticated;
revoke all on function public.xbar_release_account_deletion_holds(uuid) from public, anon, authenticated;
revoke all on function public.xbar_refuse_access_during_account_deletion() from public, anon, authenticated;
grant execute on function public.xbar_hold_owned_workspaces_for_deletion(uuid) to service_role;
grant execute on function public.xbar_release_account_deletion_holds(uuid) to service_role;
