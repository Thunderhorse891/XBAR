begin;

-- A committed relational source mutation is not consent to deliver or proof
-- that the browser's subsequent multi-table sync completed. No workspace is
-- enrolled by this migration. The table is a fence, not a dispatch queue.
create table public.xbar_private_care_source_revisions (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  enabled boolean not null default false
);
alter table public.xbar_private_care_source_revisions enable row level security;
revoke all on public.xbar_private_care_source_revisions from public, anon, authenticated, service_role;
grant select on public.xbar_private_care_source_revisions to service_role;

-- Enabling, disabling and re-enabling must invalidate a version pinned in an
-- older scan, even if no enrolled mutations occurred between those transitions.
create function public.xbar_private_care_enrollment_changed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.enabled is distinct from old.enabled then
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;
revoke all on function public.xbar_private_care_enrollment_changed() from public, anon, authenticated, service_role;
create trigger xbar_private_care_enrollment_changed
before update of enabled on public.xbar_private_care_source_revisions
for each row execute function public.xbar_private_care_enrollment_changed();

create function public.xbar_private_care_source_changed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_workspace uuid;
  v_new_workspace uuid;
  v_workspace uuid;
begin
  if TG_OP = 'UPDATE' and
    (to_jsonb(OLD) - 'updated_at') is not distinct from (to_jsonb(NEW) - 'updated_at') then
    return null;
  end if;
  if TG_OP <> 'INSERT' then
    v_old_workspace := OLD.workspace_id;
  end if;
  if TG_OP <> 'DELETE' then
    v_new_workspace := NEW.workspace_id;
  end if;

  -- On a cross-workspace move fence both scopes in stable lock order.
  for v_workspace in
    select distinct v from unnest(array[v_old_workspace, v_new_workspace]) as values_seen(v)
    where v is not null order by v
  loop
    update public.xbar_private_care_source_revisions
    set revision = revision + 1
    where workspace_id = v_workspace and enabled;
  end loop;
  return null;
end;
$$;
revoke all on function public.xbar_private_care_source_changed() from public, anon, authenticated, service_role;

create trigger xbar_private_care_horse_changed
after insert or update or delete on public.horses
for each row execute function public.xbar_private_care_source_changed();
create trigger xbar_private_care_document_changed
after insert or update or delete on public.documents
for each row execute function public.xbar_private_care_source_changed();
create trigger xbar_private_care_membership_changed
after insert or update or delete on public.workspace_memberships
for each row execute function public.xbar_private_care_source_changed();

-- Immutable keyset. A change behind the cursor is visible on the next sweep.
-- Return revision as text so callers never round a PostgreSQL bigint.
create function public.xbar_private_care_source_page(p_after uuid default null, p_limit integer default 200)
returns table(workspace_id uuid, revision text)
language sql
stable
security invoker
set search_path = ''
as $$
  select r.workspace_id, r.revision::text
  from public.xbar_private_care_source_revisions as r
  where r.enabled and (p_after is null or r.workspace_id > p_after)
  order by r.workspace_id
  limit least(greatest(coalesce(p_limit, 200), 1), 200)
$$;
revoke all on function public.xbar_private_care_source_page(uuid, integer) from public, anon, authenticated;
grant execute on function public.xbar_private_care_source_page(uuid, integer) to service_role;

commit;
