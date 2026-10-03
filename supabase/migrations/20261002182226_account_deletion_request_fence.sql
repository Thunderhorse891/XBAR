-- DRAFT: requires explicit production migration approval before the matching
-- account-delete handler is released. No client/RLS access is expanded.
--
-- A stale deletion must not release a newer deletion's membership holds. The
-- per-user request token makes release atomic; the workspace trigger keeps the
-- owned-workspace set from growing/changing behind the billing verification.
--
-- DEPLOYMENT: first drain/stop account-deletion requests, apply this migration,
-- run checks/account-deletion-request-fence.sql, then deploy the new handler.
-- The old hold RPC deliberately refuses during the transition. New code also
-- refuses if these RPCs are missing; there is no unsafe legacy fallback.
-- Existing live legacy holds require their normal 15-minute expiry before a
-- new token-owned request may start.
--
-- ROLLBACK: roll back the application only with account deletion disabled.
-- Keep this additive fence in place. Do not restore the legacy hold RPC while
-- any token-owned request or in-flight deletion exists. Restore the previous
-- protocol only after draining requests and explicit review; it reopens the
-- stale-release and workspace-growth races this migration fixes.

create table if not exists public.account_deletion_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  request_token uuid not null,
  created_at timestamptz not null default now()
);
alter table public.account_deletion_requests enable row level security;
revoke all on table public.account_deletion_requests from public, anon, authenticated;

create or replace function public.xbar_hold_account_deletion_request(p_user_id uuid, p_request_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  workspace_row record;
  existing_request public.account_deletion_requests%rowtype;
  shared uuid[] := '{}';
  held uuid[] := '{}';
begin
  if p_user_id is null or p_request_token is null then raise exception 'A user and request token are required.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('xbar-deletion:' || p_user_id::text, 0));
  select * into existing_request from public.account_deletion_requests where user_id = p_user_id;
  if (found and existing_request.created_at > now() - interval '15 minutes'
      and existing_request.request_token <> p_request_token)
    or (not found and exists (
      select 1 from public.account_deletion_holds where user_id = p_user_id
      and created_at > now() - interval '15 minutes'
    )) then
    return jsonb_build_object('ok', false, 'reason', 'deletion_in_progress', 'shared', '[]'::jsonb, 'held', '[]'::jsonb);
  end if;

  for workspace_row in select id from public.workspaces where owner_user_id = p_user_id order by id loop
    perform pg_advisory_xact_lock(hashtextextended('xbar-seats:' || workspace_row.id::text, 0));
    if exists (select 1 from public.workspace_memberships m where m.workspace_id = workspace_row.id
      and m.status = 'active' and m.user_id is distinct from p_user_id) then
      shared := shared || workspace_row.id;
    else
      held := held || workspace_row.id;
    end if;
  end loop;
  if cardinality(shared) > 0 then
    return jsonb_build_object('ok', false, 'reason', 'shared_workspace', 'shared', to_jsonb(shared), 'held', '[]'::jsonb);
  end if;

  insert into public.account_deletion_requests (user_id, request_token, created_at)
  values (p_user_id, p_request_token, now())
  on conflict (user_id) do update set request_token = excluded.request_token, created_at = excluded.created_at;
  insert into public.account_deletion_holds (workspace_id, user_id, created_at)
  select workspace_id, p_user_id, now() from unnest(held) as workspace_id
  on conflict (workspace_id) do update set user_id = excluded.user_id, created_at = excluded.created_at;
  return jsonb_build_object('ok', true, 'shared', '[]'::jsonb, 'held', to_jsonb(held));
end;
$$;

create or replace function public.xbar_release_account_deletion_request(p_user_id uuid, p_request_token uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare released integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('xbar-deletion:' || p_user_id::text, 0));
  -- Compare and delete in the database transaction, not in a prior API read.
  delete from public.account_deletion_requests where user_id = p_user_id and request_token = p_request_token;
  if not found then return 0; end if;
  delete from public.account_deletion_holds where user_id = p_user_id;
  get diagnostics released = row_count;
  return released;
end;
$$;

create or replace function public.xbar_confirm_account_deletion_request(
  p_user_id uuid, p_request_token uuid, p_workspace_ids uuid[]
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  actual_ids uuid[];
  expected_ids uuid[];
  held_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('xbar-deletion:' || p_user_id::text, 0));
  if not exists (select 1 from public.account_deletion_requests where user_id = p_user_id
    and request_token = p_request_token and created_at > now() - interval '15 minutes') then return false; end if;
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into actual_ids
  from public.workspaces where owner_user_id = p_user_id;
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into expected_ids from unnest(p_workspace_ids) as id;
  if actual_ids is distinct from expected_ids then return false; end if;
  foreach held_id in array actual_ids loop
    perform pg_advisory_xact_lock(hashtextextended('xbar-seats:' || held_id::text, 0));
    if not exists (select 1 from public.account_deletion_holds h where h.workspace_id = held_id
      and h.user_id = p_user_id and h.created_at > now() - interval '15 minutes') then return false; end if;
    if exists (select 1 from public.workspace_memberships m where m.workspace_id = held_id
      and m.status = 'active' and m.user_id is distinct from p_user_id) then return false; end if;
  end loop;
  update public.account_deletion_requests set created_at = now() where user_id = p_user_id and request_token = p_request_token;
  update public.account_deletion_holds set created_at = now() where user_id = p_user_id;
  return true;
end;
$$;

create or replace function public.xbar_refuse_workspace_ownership_during_deletion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare owner_id uuid;
begin
  if TG_OP = 'UPDATE' and new.owner_user_id = old.owner_user_id then return new; end if;
  -- Lock both sides in UUID order to avoid inverted ownership-transfer locks.
  for owner_id in
    select distinct id from unnest(case when TG_OP = 'UPDATE'
      then array[old.owner_user_id, new.owner_user_id] else array[new.owner_user_id] end) as id order by id
  loop
    perform pg_advisory_xact_lock(hashtextextended('xbar-deletion:' || owner_id::text, 0));
    if exists (select 1 from public.account_deletion_requests where user_id = owner_id
      and created_at > now() - interval '15 minutes') then
      raise exception 'Account deletion is in progress. Workspace creation or ownership changes must wait.';
    end if;
  end loop;
  return new;
end;
$$;

create or replace trigger trg_workspaces_refuse_ownership_during_deletion
before insert or update of owner_user_id on public.workspaces
for each row execute function public.xbar_refuse_workspace_ownership_during_deletion();

-- Refuse old application builds rather than silently running an unprotected
-- deletion. A clear 5xx is recoverable; an auth cascade is not.
create or replace function public.xbar_hold_owned_workspaces_for_deletion(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Account deletion requires the request-token protocol. Please retry after the deployment completes.';
end;
$$;

-- An older in-flight request may still run its cleanup after deployment. It
-- must never release a token-owned request, even after that request expires.
create or replace function public.xbar_release_account_deletion_holds(p_user_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare released integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('xbar-deletion:' || p_user_id::text, 0));
  if exists (select 1 from public.account_deletion_requests where user_id = p_user_id) then return 0; end if;
  delete from public.account_deletion_holds where user_id = p_user_id;
  get diagnostics released = row_count;
  return released;
end;
$$;

revoke all on function public.xbar_hold_account_deletion_request(uuid, uuid) from public, anon, authenticated;
revoke all on function public.xbar_release_account_deletion_request(uuid, uuid) from public, anon, authenticated;
revoke all on function public.xbar_confirm_account_deletion_request(uuid, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.xbar_refuse_workspace_ownership_during_deletion() from public, anon, authenticated;
grant execute on function public.xbar_hold_account_deletion_request(uuid, uuid) to service_role;
grant execute on function public.xbar_release_account_deletion_request(uuid, uuid) to service_role;
grant execute on function public.xbar_confirm_account_deletion_request(uuid, uuid, uuid[]) to service_role;

-- A live user fence also prevents a later checkout from stealing an expired
-- workspace lease while deletion renews/checks its other workspaces.
create or replace function public.xbar_claim_checkout_lock(
  p_workspace_id uuid, p_stale_before timestamptz, p_token text
)
returns boolean language plpgsql security definer set search_path = public as $$
declare owner_id uuid; claimed boolean;
begin
  select owner_user_id into owner_id from public.workspaces where id = p_workspace_id;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended('xbar-deletion:' || owner_id::text, 0));
  if not exists (select 1 from public.workspaces where id = p_workspace_id and owner_user_id = owner_id)
    or exists (select 1 from public.account_deletion_requests where user_id = owner_id
      and created_at > now() - interval '15 minutes') then return false; end if;
  insert into public.workspace_billing_customers as billing (workspace_id, checkout_lock_at, checkout_lock_token)
  values (p_workspace_id, now(), p_token)
  on conflict (workspace_id) do update set checkout_lock_at = now(), checkout_lock_token = p_token
    where billing.checkout_lock_at is null or billing.checkout_lock_at < p_stale_before
  returning true into claimed;
  return coalesce(claimed, false);
end;
$$;
