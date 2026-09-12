-- Administrative connection only. Synthetic auth users have no credentials;
-- every user, workspace, membership, document and storage object is rolled back.
-- Exercises real RLS under authenticated, not service-role bypass.
--
-- What this proves: a document uploaded by one member of a ranch is readable by
-- the others. That was the whole promise of a shared record, and before
-- 20260912060000_workspace_keyed_document_storage.sql it was false -- the
-- `documents` row was workspace-scoped while the object in the private
-- `horse-documents` bucket was keyed to the uploader's user id, so every other
-- member saw the document listed and got a refusal when they opened it.
begin;
do $check$
declare
  owner_id uuid := gen_random_uuid();
  admin_id uuid := gen_random_uuid();
  reader_id uuid := gen_random_uuid();
  invited_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  workspace uuid := gen_random_uuid();
  other_workspace uuid := gen_random_uuid();
  shared_object text;
  legacy_object text;
  retained_object text;
  junk_object text := 'not-a-uuid/documents/fixture/junk.pdf';
  media_object text;
  affected integer;
begin
  shared_object := workspace::text || '/documents/fixture/shared.pdf';
  legacy_object := admin_id::text || '/documents/fixture/legacy.pdf';
  retained_object := admin_id::text || '/documents/fixture/retained.pdf';
  media_object := workspace::text || '/horses/fixture/photo.jpg';

  insert into auth.users (id, email, email_confirmed_at) values
    (owner_id, owner_id::text || '@example.invalid', now()),
    (admin_id, admin_id::text || '@example.invalid', now()),
    (reader_id, reader_id::text || '@example.invalid', now()),
    (invited_id, invited_id::text || '@example.invalid', now()),
    (outsider_id, outsider_id::text || '@example.invalid', now());

  insert into public.workspaces (id, owner_user_id, workspace_key) values
    (workspace, owner_id, workspace::text),
    (other_workspace, outsider_id, other_workspace::text);
  insert into public.workspace_profiles (workspace_id) values (workspace), (other_workspace);
  -- Seat and storage capacity are independent of the authorization cases below.
  insert into public.workspace_subscription_profiles (workspace_id, tier, billing_state) values
    (workspace, 'Professional', 'Manual Billing'),
    (other_workspace, 'Professional', 'Manual Billing');

  -- The workspace OWNER deliberately gets no membership row of their own: the
  -- object policies must recognise the same authority the table policies do.
  insert into public.workspace_memberships (workspace_id, user_id, email, role, status) values
    (workspace, admin_id, admin_id::text || '@example.invalid', 'Admin', 'active'),
    (workspace, reader_id, reader_id::text || '@example.invalid', 'Ranch Manager', 'active'),
    (workspace, invited_id, invited_id::text || '@example.invalid', 'Admin', 'invited'),
    (other_workspace, outsider_id, outsider_id::text || '@example.invalid', 'Admin', 'active');

  -- Objects that are already in the bucket arrived before these policies
  -- existed, so they are seeded the way real data is: not through them.
  insert into storage.objects (bucket_id, name, owner) values
    ('horse-documents', shared_object, admin_id),
    ('horse-documents', legacy_object, admin_id),
    ('horse-documents', retained_object, admin_id),
    ('horse-documents', junk_object, admin_id),
    ('horse-media', media_object, admin_id);

  -- ------------------------------------------------------------- the upload
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner)
  values ('horse-documents', workspace::text || '/documents/fixture/new.pdf', admin_id);
  insert into public.documents (workspace_id, document_id, title, storage_path, uploaded_by_user_id)
  values (workspace, 'fixture-doc', 'Fixture coggins', shared_object, admin_id);
  -- An Admin may not name a workspace they do not belong to.
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('horse-documents', other_workspace::text || '/documents/fixture/forged.pdf', admin_id);
    raise exception 'Member uploaded into another tenant workspace';
  exception when insufficient_privilege then null;
  end;
  -- Nor may they keep minting objects only they can read.
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('horse-documents', admin_id::text || '/documents/fixture/new-legacy.pdf', admin_id);
    raise exception 'Uploader-keyed object path is still mintable';
  exception when insufficient_privilege then null;
  end;
  -- A path whose first segment is not a workspace id grants nothing, and must
  -- not raise 22P02: a policy that throws is an outage rather than a denial.
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('horse-documents', 'not-a-uuid/documents/fixture/new.pdf', admin_id);
    raise exception 'Object with a non-workspace path was accepted';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from storage.objects where bucket_id = 'horse-documents' and name = legacy_object) <> 1
    then raise exception 'Uploader lost access to their own legacy object'; end if;
  reset role;

  -- The workspace owner, who has no membership row, may still upload.
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner)
  values ('horse-documents', workspace::text || '/documents/fixture/by-owner.pdf', owner_id);
  reset role;

  -- A member who may read the workspace but not manage it may not write an
  -- object either: the `documents` row for it would be refused a statement
  -- later, leaving an orphan in a private bucket with nothing pointing at it.
  perform set_config('request.jwt.claim.sub', reader_id::text, true);
  set local role authenticated;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('horse-documents', workspace::text || '/documents/fixture/by-reader.pdf', reader_id);
    raise exception 'Read-only member uploaded an object they cannot record';
  exception when insufficient_privilege then null;
  end;

  -- --------------------------------------------------------------- the fix
  if (select count(*) from public.documents where workspace_id = workspace and document_id = 'fixture-doc') <> 1
    then raise exception 'Member cannot read the document row'; end if;
  if (select count(*) from storage.objects where bucket_id = 'horse-documents' and name = shared_object) <> 1
    then raise exception 'Member can read the document row but not the file'; end if;
  -- Reading is all they get: renaming an object is a manage operation. The row
  -- is found (they may read it) and then refused on the way back in, so this
  -- denial arrives as an error rather than as an empty update.
  begin
    update storage.objects set name = workspace::text || '/documents/fixture/renamed.pdf'
    where bucket_id = 'horse-documents' and name = shared_object;
    raise exception 'Read-only member rewrote an object';
  exception when insufficient_privilege then null;
  end;
  -- A full-bucket listing crosses the badly named object without throwing, and
  -- shows nothing outside this member's workspace.
  if exists (
    select 1 from storage.objects
    where bucket_id = 'horse-documents' and split_part(name, '/', 1) <> workspace::text
  ) then raise exception 'Member saw an object outside their workspace'; end if;
  -- Someone else's legacy object is no more visible than it was before.
  if exists (select 1 from storage.objects where bucket_id = 'horse-documents' and name = legacy_object)
    then raise exception 'Legacy uploader-keyed object leaked to another member'; end if;
  reset role;

  -- The workspace owner reads it too.
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  set local role authenticated;
  if (select count(*) from storage.objects where bucket_id = 'horse-documents' and name = shared_object) <> 1
    then raise exception 'Workspace owner cannot read a shared document'; end if;
  reset role;

  -- ---------------------------------------------------------- who may not
  perform set_config('request.jwt.claim.sub', invited_id::text, true);
  set local role authenticated;
  if exists (select 1 from storage.objects where bucket_id = 'horse-documents' and name = shared_object)
    then raise exception 'Invited-but-inactive member read a shared document'; end if;
  reset role;

  perform set_config('request.jwt.claim.sub', outsider_id::text, true);
  set local role authenticated;
  if exists (select 1 from storage.objects where bucket_id = 'horse-documents')
    then raise exception 'Another tenant read this workspace bucket'; end if;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('horse-documents', workspace::text || '/documents/fixture/by-outsider.pdf', outsider_id);
    raise exception 'Another tenant uploaded into this workspace';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform set_config('request.jwt.claim.sub', null, true);
  set local role authenticated;
  if exists (select 1 from storage.objects where bucket_id = 'horse-documents')
    then raise exception 'Signed-out caller read the documents bucket'; end if;
  reset role;

  -- ------------------------------------------------------------ migration
  -- An Admin may move their own legacy object into the workspace namespace,
  -- but an update is never a way out of it.
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  set local role authenticated;
  update storage.objects set name = workspace::text || '/documents/fixture/migrated.pdf'
  where bucket_id = 'horse-documents' and name = legacy_object;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Uploader cannot migrate their own legacy object'; end if;
  begin
    update storage.objects set name = other_workspace::text || '/documents/fixture/stolen.pdf'
    where bucket_id = 'horse-documents' and name = shared_object;
    raise exception 'Update moved an object into another tenant';
  exception when insufficient_privilege then null;
  end;
  begin
    update storage.objects set name = admin_id::text || '/documents/fixture/back.pdf'
    where bucket_id = 'horse-documents' and name = shared_object;
    raise exception 'Update minted an uploader-keyed object';
  exception when insufficient_privilege then null;
  end;
  -- This migration grants nothing outside its own bucket.
  if exists (select 1 from storage.objects where bucket_id = 'horse-media' and name = media_object)
    then raise exception 'Document policies granted reads in the media bucket'; end if;

  -- ------------------------------------------------------------ upsert
  -- Supabase's `upload({ upsert: true })` is INSERT ... ON CONFLICT DO UPDATE,
  -- which Postgres checks against BOTH the insert and the update policy. It is
  -- the one path that could satisfy neither on its own and still write, so it
  -- is exercised rather than assumed.
  insert into storage.objects (bucket_id, name, owner)
  values ('horse-documents', shared_object, admin_id)
  on conflict (bucket_id, name) do update set owner = excluded.owner;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'A manager cannot replace a file in their own workspace'; end if;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('horse-documents', other_workspace::text || '/documents/fixture/upsert.pdf', admin_id)
    on conflict (bucket_id, name) do update set owner = excluded.owner;
    raise exception 'Upsert wrote into another tenant workspace';
  exception when insufficient_privilege then null;
  end;

  -- ------------------------------------------------------------ delete
  -- DELETE carries no policy and so is denied for everyone, the workspace owner
  -- included. The application never removes an object, and leaving the command
  -- unpoliced is the safe default for the one operation that destroys a
  -- customer's file; account deletion runs server-side with the service role
  -- and is unaffected. With no policy granting it, no row is visible to delete,
  -- so the refusal is an empty delete rather than an error.
  delete from storage.objects where bucket_id = 'horse-documents' and name = shared_object;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'A manager deleted a stored file through the client'; end if;
  reset role;

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  set local role authenticated;
  delete from storage.objects where bucket_id = 'horse-documents' and name = shared_object;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'The workspace owner deleted a stored file through the client'; end if;
  reset role;

  -- --------------------------------------------------- leaving the ranch
  -- Access ends when membership does, both ways a membership can end: the row
  -- removed outright, and the row deactivated. A file is only as shared as the
  -- membership behind it.
  delete from public.workspace_memberships where workspace_id = workspace and user_id = reader_id;
  perform set_config('request.jwt.claim.sub', reader_id::text, true);
  set local role authenticated;
  if exists (select 1 from storage.objects where bucket_id = 'horse-documents' and name = shared_object)
    then raise exception 'A removed member still reads the workspace files'; end if;
  reset role;

  update public.workspace_memberships set status = 'inactive'
  where workspace_id = workspace and user_id = admin_id;
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  set local role authenticated;
  if exists (select 1 from storage.objects where bucket_id = 'horse-documents' and name = shared_object)
    then raise exception 'A deactivated member still reads the workspace files'; end if;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('horse-documents', workspace::text || '/documents/fixture/after-removal.pdf', admin_id);
    raise exception 'A deactivated member still uploads to the workspace';
  exception when insufficient_privilege then null;
  end;
  -- KNOWN RESIDUAL, asserted rather than left to be discovered. The SELECT
  -- policy keeps uploader-keyed objects readable by their uploader, which is
  -- what stops this migration breaking every document a customer already has.
  -- The cost is that a member who leaves keeps read access to the files THEY
  -- uploaded under the old scheme. It is bounded three ways: only objects
  -- written before this migration, only for the account that wrote them, and
  -- only until that file is re-uploaded -- which is exactly what the app now
  -- tells a teammate to do when an old file will not open for them. Closing it
  -- instead would make every pre-existing document unopenable for everyone,
  -- including its uploader, which is a worse day for a real ranch.
  if (select count(*) from storage.objects where bucket_id = 'horse-documents' and name = retained_object) <> 1
    then raise exception 'Legacy objects stopped being readable by their uploader'; end if;
  reset role;
end;
$check$;
rollback;
select 'PASS: workspace members share documents, owners without membership rows included; inactive, removed, outside-tenant and signed-out callers refused on read and write; insert, update, upsert and delete all covered; uploader-keyed paths no longer mintable but legacy objects still readable and migratable; non-workspace paths denied rather than raising; all fixtures rolled back' as result;
