-- Administrative connection only. Every user, workspace, membership, document
-- and storage row is rolled back. Exercises real RLS under `authenticated`,
-- not service-role bypass.
--
-- What it proves: a member of a workspace can read the private storage object
-- that one of that workspace's document rows names, and nobody else can --
-- including for an object no document row names.
--
-- Run AFTER 20260911150000_shared_document_storage_access.sql. Before it, the
-- member case raises 'Member cannot read a shared document object', which is
-- the defect the migration exists to fix.
begin;
do $check$
declare
  owner_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  workspace uuid := gen_random_uuid();
  shared_object text;
  stray_object text;
begin
  shared_object := owner_id::text || '/documents/storage-check/shared.pdf';
  stray_object := owner_id::text || '/documents/storage-check/stray.pdf';

  insert into auth.users (id, email, email_confirmed_at) values
    (owner_id, owner_id::text || '@example.invalid', now()),
    (member_id, member_id::text || '@example.invalid', now()),
    (outsider_id, outsider_id::text || '@example.invalid', now());

  insert into public.workspaces (id, owner_user_id, workspace_key) values (workspace, owner_id, workspace::text);
  insert into public.workspace_memberships (workspace_id, user_id, email, role, status) values
    (workspace, owner_id, owner_id::text || '@example.invalid', 'Admin', 'active'),
    (workspace, member_id, member_id::text || '@example.invalid', 'Owner', 'active');

  -- The record the workspace shares, and the object it names.
  insert into public.documents (workspace_id, document_id, title, storage_path)
  values (workspace, 'storage-check-doc', 'Storage access check', shared_object);
  insert into storage.objects (bucket_id, name, owner, owner_id) values
    ('horse-documents', shared_object, owner_id, owner_id::text),
    ('horse-documents', stray_object, owner_id, owner_id::text);

  -- The uploader, who could always read their own prefix.
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id)::text, true);
  set local role authenticated;
  if not exists (select 1 from storage.objects where name = shared_object) then
    raise exception 'Uploader cannot read their own document object';
  end if;
  reset role;

  -- The teammate. This is the case that failed before the migration: the
  -- document ROW was readable and the object it names was not.
  perform set_config('request.jwt.claim.sub', member_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', member_id)::text, true);
  set local role authenticated;
  if not exists (select 1 from public.documents where storage_path = shared_object) then
    raise exception 'Member cannot read the shared document record';
  end if;
  if not exists (select 1 from storage.objects where name = shared_object) then
    raise exception 'Member cannot read a shared document object';
  end if;
  -- Widened only as far as the records reach: an object no row names stays shut.
  if exists (select 1 from storage.objects where name = stray_object) then
    raise exception 'Member read an object no document row names';
  end if;
  reset role;

  -- Nobody else.
  perform set_config('request.jwt.claim.sub', outsider_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', outsider_id)::text, true);
  set local role authenticated;
  if exists (select 1 from storage.objects where name in (shared_object, stray_object)) then
    raise exception 'Outsider read a workspace document object';
  end if;
  if exists (select 1 from public.documents where storage_path = shared_object) then
    raise exception 'Outsider read a workspace document record';
  end if;
  reset role;

  raise notice 'shared document storage access: all cases passed';
end
$check$;
rollback;
