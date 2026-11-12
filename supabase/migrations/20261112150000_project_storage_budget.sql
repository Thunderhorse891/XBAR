-- Prepared local-only coordinated-upload budget; explicit approval before production.
-- This does not revoke old signed URLs or constrain privileged provider writers.
begin;
create table public.upload_project_budget (
  singleton boolean primary key default true check(singleton),
  limit_bytes bigint not null check(limit_bytes between 0 and 9007199254740991)
);
insert into public.upload_project_budget values(true,900000000);
alter table public.upload_project_budget enable row level security;
revoke all on public.upload_project_budget from public,anon,authenticated,service_role;
-- Intentionally owner-operated SQL only. No application setter or public totals.
create function public.xbar_project_upload_admission_bytes()
returns numeric language plpgsql stable security definer set search_path=public as $$
declare actual numeric; pending numeric;
begin
  if exists(select 1 from storage.objects where public.xbar_storage_metadata_bytes(metadata) is null) then
    raise exception 'Project storage capacity could not be verified. Upload not started.' using errcode='PZ002';
  end if;
  select coalesce(sum(public.xbar_storage_metadata_bytes(metadata)),0) into actual from storage.objects;
  select coalesce(sum(greatest(r.expected_bytes-coalesce((
    select sum(public.xbar_storage_metadata_bytes(o.metadata)) from storage.objects o
    where o.bucket_id=r.bucket_id and o.name=r.object_path
  ),0),0)),0) into pending from public.workspace_upload_reservations r where r.state not in ('stored','aborted');
  return actual+pending;
end;
$$;
revoke all on function public.xbar_project_upload_admission_bytes() from public,anon,authenticated,service_role;
create function public.xbar_guard_project_upload_budget()
returns trigger language plpgsql volatile security definer set search_path=public as $$
declare budget bigint; charged numeric;
begin
  -- All workspace admission paths converge here. SELECT after the row lock uses
  -- a fresh READ COMMITTED snapshot; the stable counter uses one coherent view.
  if current_setting('transaction_isolation') <> 'read committed' then
    raise exception 'Upload admission requires read committed isolation.' using errcode='55000';
  end if;
  select limit_bytes into budget from public.upload_project_budget where singleton for update;
  -- A concurrent same-ID request can miss the RPC's earlier lookup. Never
  -- report not-started if that reservation has since committed.
  if exists(select 1 from public.workspace_upload_reservations where id=new.id) then
    raise exception 'Upload reservation identity conflict.' using errcode='55000';
  end if;
  if budget is null then
    raise exception 'Project storage capacity could not be verified. Upload not started.' using errcode='PZ002';
  end if;
  charged:=public.xbar_project_upload_admission_bytes();
  if charged+new.expected_bytes>budget then
    raise exception 'Project storage capacity reached. Upload not started.' using errcode='PZ001';
  end if;
  return new;
end;
$$;
revoke all on function public.xbar_guard_project_upload_budget() from public,anon,authenticated,service_role;
create trigger xbar_project_upload_budget before insert on public.workspace_upload_reservations
for each row execute function public.xbar_guard_project_upload_budget();
commit;
