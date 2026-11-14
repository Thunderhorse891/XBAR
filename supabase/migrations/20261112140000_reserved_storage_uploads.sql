-- Prepared strict-upload release. Apply only after server-controlled multipart
-- endpoints are ready and the owner explicitly approves production migration.
-- No Storage object mutations/triggers and no expiring-away reservations.
begin;

create table if not exists public.workspace_upload_reservations (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid not null,
  bucket_id text not null check (bucket_id in ('horse-documents', 'horse-media', 'sale-packets')),
  object_path text not null,
  expected_bytes bigint not null check (expected_bytes >= 0 and expected_bytes <= 9007199254740991),
  content_type text not null,
  upload_kind text not null default 'document' check (upload_kind in ('document','media','receipt','packet')),
  part_size_bytes bigint not null default 8388608 check (part_size_bytes = 8388608),
  state text not null default 'reserved' check (state in ('reserved','uploading','completing','aborting','stored','aborted','reconcile')),
  provider_upload_id text,
  claim_token uuid,
  claim_action text check (claim_action in ('create','verify','complete','abort')),
  completion_started_at timestamptz,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (bucket_id, object_path)
);
alter table public.workspace_upload_reservations enable row level security;
revoke all on public.workspace_upload_reservations from public, anon, authenticated, service_role;
grant select on public.workspace_upload_reservations to service_role;
create index if not exists workspace_upload_reservations_active_idx
  on public.workspace_upload_reservations(workspace_id) where state not in ('stored','aborted');

-- A stable nested accounting function shares its enclosing statement snapshot.
-- This matters when an object becomes visible while its reservation remains
-- active: never read actual bytes before the object and its deduction after it.
alter function public.xbar_workspace_storage_bytes_internal(uuid) stable;
create or replace function public.xbar_workspace_upload_admission_bytes(p_workspace_id uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select public.xbar_workspace_storage_bytes_internal(p_workspace_id)
    + coalesce((select sum(greatest(r.expected_bytes - coalesce((
        select sum(public.xbar_storage_metadata_bytes(o.metadata)) from storage.objects o
        where o.bucket_id = r.bucket_id and o.name = r.object_path
      ),0),0))
      from public.workspace_upload_reservations r
      where r.workspace_id = p_workspace_id and r.state not in ('stored','aborted')),0)::bigint
$$;
revoke all on function public.xbar_workspace_upload_admission_bytes(uuid) from public, anon, authenticated, service_role;

create or replace function public.xbar_upload_actor_has_access(p_workspace_id uuid, p_actor_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.workspaces where id=p_workspace_id and owner_user_id=p_actor_user_id)
    or exists(select 1 from public.workspace_memberships
      where workspace_id=p_workspace_id and user_id=p_actor_user_id and status='active')
$$;
revoke all on function public.xbar_upload_actor_has_access(uuid,uuid) from public, anon, authenticated, service_role;

create or replace function public.xbar_reserve_upload(
  p_reservation_id uuid, p_workspace_id uuid, p_actor_user_id uuid,
  p_bucket_id text, p_object_path text, p_expected_bytes bigint,
  p_content_type text default 'application/octet-stream', p_upload_kind text default 'document'
) returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.workspace_upload_reservations; used_bytes bigint; limit_gb integer;
begin
  if p_reservation_id is null or p_workspace_id is null or p_actor_user_id is null
    or p_bucket_id is null or p_bucket_id not in ('horse-documents','horse-media','sale-packets')
    or p_upload_kind is null or p_upload_kind not in ('document','media','receipt','packet')
    or (p_upload_kind='media') is distinct from (p_bucket_id='horse-media')
    or (p_upload_kind='packet') is distinct from (p_bucket_id='sale-packets')
    or p_object_path is null or lower(split_part(p_object_path,'/',1)) <> p_workspace_id::text
    or lower(p_object_path) not like p_workspace_id::text||'/%'
    or position(p_reservation_id::text in p_object_path)=0
    or p_object_path ~ '(^|/)\.\.(/|$)' or position(chr(92) in p_object_path)>0
    or p_expected_bytes is null or p_expected_bytes<0 or p_expected_bytes>9007199254740991
    or p_content_type is null or length(btrim(p_content_type))=0 or length(p_content_type)>255
    or p_content_type ~ E'[\r\n]' then
    raise exception 'Invalid upload reservation.' using errcode='22023';
  end if;
  -- API checks the bucket-specific capability; DB independently prevents a
  -- service request from attributing the reservation to another ranch's user.
  if not public.xbar_upload_actor_has_access(p_workspace_id,p_actor_user_id) then
    raise exception 'Workspace access required.' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_workspace_id::text,0));
  select * into r from public.workspace_upload_reservations where id=p_reservation_id for update;
  if found then
    if (r.workspace_id,r.actor_user_id,r.bucket_id,r.object_path,r.expected_bytes,r.content_type,r.upload_kind)
      is distinct from (p_workspace_id,p_actor_user_id,p_bucket_id,p_object_path,p_expected_bytes,p_content_type,p_upload_kind) then
      raise exception 'Upload reservation identity mismatch.' using errcode='22023';
    end if;
    return to_jsonb(r);
  end if;
  if exists(select 1 from storage.objects where bucket_id=p_bucket_id and name=p_object_path) then
    raise exception 'Upload object already exists.' using errcode='55000';
  end if;
  if exists(select 1 from public.account_deletion_holds where workspace_id=p_workspace_id
    and created_at > now()-interval '15 minutes') then
    raise exception 'Workspace deletion is in progress.' using errcode='55000';
  end if;
  used_bytes := public.xbar_workspace_upload_admission_bytes(p_workspace_id);
  select storage_limit_gb into limit_gb from public.xbar_subscription_limits(p_workspace_id);
  if p_expected_bytes>0 and used_bytes+p_expected_bytes>limit_gb::bigint*1073741824 then
    raise exception 'Storage limit reached for this workspace.';
  end if;
  insert into public.workspace_upload_reservations(id,workspace_id,actor_user_id,bucket_id,object_path,expected_bytes,content_type,upload_kind)
    values(p_reservation_id,p_workspace_id,p_actor_user_id,p_bucket_id,p_object_path,p_expected_bytes,p_content_type,p_upload_kind)
    returning * into r;
  return to_jsonb(r);
end;
$$;

create or replace function public.xbar_begin_upload(p_reservation_id uuid,p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.workspace_upload_reservations;
begin
  if p_claim_token is null then raise exception 'Upload claim is required.' using errcode='22023'; end if;
  select * into r from public.workspace_upload_reservations where id=p_reservation_id for update;
  if not found or r.state<>'reserved' then raise exception 'Upload state conflict.' using errcode='55000'; end if;
  if not public.xbar_upload_actor_has_access(r.workspace_id,r.actor_user_id) then
    raise exception 'Workspace access required.' using errcode='42501'; end if;
  update public.workspace_upload_reservations set state='uploading',claim_token=p_claim_token,claim_action='create',updated_at=clock_timestamp()
    where id=p_reservation_id returning * into r;
  return to_jsonb(r);
end;
$$;

create or replace function public.xbar_bind_upload(p_reservation_id uuid,p_claim_token uuid,p_provider_upload_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.workspace_upload_reservations;
begin
  if p_provider_upload_id is null or length(btrim(p_provider_upload_id))=0 or p_claim_token is null then
    raise exception 'Provider upload identity is required.' using errcode='22023'; end if;
  update public.workspace_upload_reservations set state='uploading',provider_upload_id=p_provider_upload_id,
    claim_token=null,claim_action=null,last_error=null,updated_at=clock_timestamp()
    where id=p_reservation_id and state in ('uploading','reconcile') and claim_action='create'
      and claim_token=p_claim_token and provider_upload_id is null and completion_started_at is null
    returning * into r;
  if not found then raise exception 'Upload state conflict.' using errcode='55000'; end if;
  return to_jsonb(r);
end;
$$;

create or replace function public.xbar_claim_upload_completion(p_reservation_id uuid,p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.workspace_upload_reservations;
begin
  if p_claim_token is null then raise exception 'Upload claim is required.' using errcode='22023'; end if;
  select * into r from public.workspace_upload_reservations where id=p_reservation_id for update;
  if not found or r.state<>'uploading' or r.provider_upload_id is null or r.claim_token is not null then
    raise exception 'Upload state conflict.' using errcode='55000'; end if;
  if not public.xbar_upload_actor_has_access(r.workspace_id,r.actor_user_id) then
    raise exception 'Workspace access required.' using errcode='42501'; end if;
  update public.workspace_upload_reservations set state='completing',claim_action='verify',claim_token=p_claim_token,updated_at=clock_timestamp()
    where id=p_reservation_id returning * into r;
  return to_jsonb(r);
end;
$$;

create or replace function public.xbar_release_upload_completion(p_reservation_id uuid,p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.workspace_upload_reservations;
begin
  update public.workspace_upload_reservations set state='uploading',claim_token=null,claim_action=null,last_error=null,updated_at=clock_timestamp()
    where id=p_reservation_id and state in ('completing','reconcile') and claim_action='verify'
      and claim_token=p_claim_token and completion_started_at is null returning * into r;
  if not found then raise exception 'Upload state conflict.' using errcode='55000'; end if;
  return to_jsonb(r);
end;
$$;

create or replace function public.xbar_start_upload_completion(p_reservation_id uuid,p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.workspace_upload_reservations;
begin
  select * into r from public.workspace_upload_reservations where id=p_reservation_id for update;
  if not found or r.state<>'completing' or r.claim_action is distinct from 'verify'
    or r.claim_token is distinct from p_claim_token or p_claim_token is null or r.completion_started_at is not null then
    raise exception 'Upload state conflict.' using errcode='55000'; end if;
  if not public.xbar_upload_actor_has_access(r.workspace_id,r.actor_user_id) then
    raise exception 'Workspace access required.' using errcode='42501'; end if;
  update public.workspace_upload_reservations set claim_action='complete',completion_started_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=p_reservation_id returning * into r;
  return to_jsonb(r);
end;
$$;

create or replace function public.xbar_claim_upload_abort(p_reservation_id uuid,p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.workspace_upload_reservations;
begin
  if p_claim_token is null then raise exception 'Upload claim is required.' using errcode='22023'; end if;
  update public.workspace_upload_reservations set state='aborting',claim_action='abort',claim_token=p_claim_token,updated_at=clock_timestamp()
    where id=p_reservation_id and completion_started_at is null
      and (state='reserved' or (state='uploading' and provider_upload_id is not null and claim_token is null))
    returning * into r;
  if not found then raise exception 'Upload state conflict.' using errcode='55000'; end if;
  return to_jsonb(r);
end;
$$;

create or replace function public.xbar_mark_upload_reconcile(p_reservation_id uuid,p_claim_token uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.workspace_upload_reservations;
begin
  update public.workspace_upload_reservations set state='reconcile',last_error=left(coalesce(p_reason,'Provider outcome requires verification.'),500),updated_at=clock_timestamp()
    where id=p_reservation_id and state in ('uploading','completing','aborting','reconcile')
      and claim_token=p_claim_token and claim_action is not null returning * into r;
  if not found then raise exception 'Upload state conflict.' using errcode='55000'; end if;
  return to_jsonb(r);
end;
$$;

create or replace function public.xbar_settle_upload_stored(p_reservation_id uuid,p_claim_token uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.workspace_upload_reservations; actual_bytes bigint; object_count bigint;
begin
  select * into r from public.workspace_upload_reservations where id=p_reservation_id for update;
  if not found or r.state not in ('completing','reconcile') or r.claim_action is distinct from 'complete'
    or r.claim_token is distinct from p_claim_token or p_claim_token is null or r.completion_started_at is null then
    raise exception 'Upload state conflict.' using errcode='55000'; end if;
  select count(*),max(public.xbar_storage_metadata_bytes(metadata)) into object_count,actual_bytes
    from storage.objects where bucket_id=r.bucket_id and name=r.object_path;
  if object_count<>1 or actual_bytes is distinct from r.expected_bytes then
    raise exception 'Stored upload bytes could not be verified.' using errcode='55000'; end if;
  update public.workspace_upload_reservations set state='stored',last_error=null,updated_at=clock_timestamp()
    where id=p_reservation_id returning * into r;
  return to_jsonb(r);
end;
$$;

create or replace function public.xbar_settle_upload_aborted(p_reservation_id uuid,p_claim_token uuid,p_provider_confirmed boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.workspace_upload_reservations;
begin
  select * into r from public.workspace_upload_reservations where id=p_reservation_id for update;
  if not found or r.state not in ('aborting','reconcile') or r.claim_action is distinct from 'abort'
    or r.claim_token is distinct from p_claim_token or p_claim_token is null or r.completion_started_at is not null
    or p_provider_confirmed is distinct from true then
    raise exception 'Upload abort could not be verified.' using errcode='55000'; end if;
  if exists(select 1 from storage.objects where bucket_id=r.bucket_id and name=r.object_path) then
    raise exception 'A stored object must not be released as aborted.' using errcode='55000'; end if;
  update public.workspace_upload_reservations set state='aborted',last_error=null,updated_at=clock_timestamp()
    where id=p_reservation_id returning * into r;
  return to_jsonb(r);
end;
$$;

-- Do not erase an in-flight/uncertain reservation through workspace cascades.
-- Terminal rows can cascade during the existing account-deletion workflow.
create or replace function public.xbar_guard_workspace_pending_uploads()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- The reservation FK's key-share lock already serializes new reservations
  -- with workspace deletion. Taking the workspace advisory lock here would
  -- invert reserve's advisory-then-FK lock order and risk a deadlock.
  if exists(select 1 from public.workspace_upload_reservations
    where workspace_id=old.id and state not in ('stored','aborted')) then
    raise exception 'Resolve pending uploads before deleting this workspace.' using errcode='55000'; end if;
  return old;
end;
$$;
revoke all on function public.xbar_guard_workspace_pending_uploads() from public, anon, authenticated, service_role;
drop trigger if exists trg_workspace_pending_uploads on public.workspaces;
create trigger trg_workspace_pending_uploads before delete on public.workspaces
  for each row execute function public.xbar_guard_workspace_pending_uploads();

-- Restrictive policies remain effective even if a permissive legacy write
-- policy survives. Supported S3 server credentials bypass RLS; user JWTs cannot
-- complete/copy/update an app object outside the reservation-controlled API.
drop policy if exists "xbar reserved uploads only insert" on storage.objects;
create policy "xbar reserved uploads only insert" on storage.objects as restrictive
  for insert to authenticated with check(bucket_id not in ('horse-documents','horse-media','sale-packets'));
drop policy if exists "xbar reserved uploads only update" on storage.objects;
create policy "xbar reserved uploads only update" on storage.objects as restrictive
  for update to authenticated
  using(bucket_id not in ('horse-documents','horse-media','sale-packets'))
  with check(bucket_id not in ('horse-documents','horse-media','sale-packets'));

-- All mutation entrypoints are service-only. Table DML is not granted even to
-- service_role so ordinary PostgREST writes cannot skip the CAS state machine.
do $$ declare f text;
begin
  foreach f in array array[
    'xbar_reserve_upload(uuid,uuid,uuid,text,text,bigint,text,text)',
    'xbar_begin_upload(uuid,uuid)','xbar_bind_upload(uuid,uuid,text)',
    'xbar_claim_upload_completion(uuid,uuid)','xbar_release_upload_completion(uuid,uuid)',
    'xbar_start_upload_completion(uuid,uuid)','xbar_claim_upload_abort(uuid,uuid)',
    'xbar_mark_upload_reconcile(uuid,uuid,text)','xbar_settle_upload_stored(uuid,uuid)',
    'xbar_settle_upload_aborted(uuid,uuid,boolean)'
  ] loop
    execute 'revoke all on function public.'||f||' from public, anon, authenticated';
    execute 'grant execute on function public.'||f||' to service_role';
  end loop;
end $$;
commit;
