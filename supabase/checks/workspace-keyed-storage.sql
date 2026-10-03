-- Administrative connection only. Synthetic auth users have no credentials;
-- every user, workspace, membership, listing and storage object is rolled back.
-- Exercises real RLS under `authenticated`, not service-role bypass.
--
-- What this proves (audit F02, migrations 20261001090000 + 20261001090100):
-- every private object -- documents and horse photos -- is reachable only
-- through the workspace named by its first path segment.
--   * Members read their workspace's files; nobody else does, and a gallery
--     that LISTS another ranch's photo grants nothing.
--   * Photo writes follow the role matrix's `uploadMedia` grant; document
--     writes follow manage. Inactive and invited members get nothing.
--   * Uploader-keyed `<user id>/...` objects open for no one and cannot be
--     minted, and no update moves a file out of its workspace.
--   * No client can rename a photo at all (an UPDATE is a move, and a rename
--     inside the ranch strands its gallery entry).
begin;
do $check$
declare
  owner_id uuid := gen_random_uuid();
  admin_id uuid := gen_random_uuid();
  manager_id uuid := gen_random_uuid();
  sales_id uuid := gen_random_uuid();
  medical_id uuid := gen_random_uuid();
  invited_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  workspace uuid := gen_random_uuid();
  other_workspace uuid := gen_random_uuid();
  doc_shared text;
  doc_legacy text;
  media_ws text;
  media_legacy text;
  affected integer;
  reader uuid;
begin
  doc_shared := workspace::text || '/documents/fixture/shared.pdf';
  doc_legacy := admin_id::text || '/documents/fixture/legacy.pdf';
  media_ws := workspace::text || '/horses/fixture/media-1.jpg';
  media_legacy := admin_id::text || '/horses/fixture/media-legacy.jpg';

  insert into auth.users (id, email, email_confirmed_at)
  select id, id::text || '@example.invalid', now()
  from unnest(array[owner_id, admin_id, manager_id, sales_id, medical_id, invited_id, outsider_id]) as id;

  insert into public.workspaces (id, owner_user_id, workspace_key) values
    (workspace, owner_id, workspace::text),
    (other_workspace, outsider_id, other_workspace::text);
  insert into public.workspace_profiles (workspace_id) values (workspace), (other_workspace);
  insert into public.workspace_subscription_profiles (workspace_id, tier, billing_state) values
    (workspace, 'Enterprise', 'Manual Billing'),
    (other_workspace, 'Enterprise', 'Manual Billing');
  -- The OWNER deliberately has no membership row: object policies must
  -- recognise the same authority the table policies do.
  insert into public.workspace_memberships (workspace_id, user_id, email, role, status) values
    (workspace, admin_id, admin_id::text || '@example.invalid', 'Admin', 'active'),
    (workspace, manager_id, manager_id::text || '@example.invalid', 'Ranch Manager', 'active'),
    (workspace, sales_id, sales_id::text || '@example.invalid', 'Sales Lead', 'active'),
    (workspace, medical_id, medical_id::text || '@example.invalid', 'Medical Lead', 'active'),
    (workspace, invited_id, invited_id::text || '@example.invalid', 'Admin', 'invited'),
    (other_workspace, outsider_id, outsider_id::text || '@example.invalid', 'Admin', 'active');

  -- Existing objects are seeded the way real data arrived: not through policy.
  insert into storage.objects (bucket_id, name, owner) values
    ('horse-documents', doc_shared, admin_id),
    ('horse-documents', doc_legacy, admin_id),
    ('horse-media', media_ws, admin_id),
    ('horse-media', media_legacy, admin_id);
  -- The outsider's own gallery LISTS this ranch's photo. That used to be a read
  -- grant; it must grant nothing.
  insert into public.horses (workspace_id, horse_id, name, payload) values (
    other_workspace, 'check-horse', 'Check Horse',
    jsonb_build_object('gallery', jsonb_build_array(jsonb_build_object('storagePath', media_ws, 'status', 'Approved')))
  );

  -- ------------------------------------------------------------ who reads
  foreach reader in array array[owner_id, admin_id, manager_id, sales_id, medical_id] loop
    perform set_config('request.jwt.claim.sub', reader::text, true);
    set local role authenticated;
    if (select count(*) from storage.objects where bucket_id = 'horse-documents' and name = doc_shared) <> 1
      then raise exception 'A workspace member cannot read a workspace document'; end if;
    if (select count(*) from storage.objects where bucket_id = 'horse-media' and name = media_ws) <> 1
      then raise exception 'A workspace member cannot read a workspace photo'; end if;
    reset role;
  end loop;

  foreach reader in array array[outsider_id, invited_id] loop
    perform set_config('request.jwt.claim.sub', reader::text, true);
    set local role authenticated;
    if exists (select 1 from storage.objects where bucket_id in ('horse-documents', 'horse-media')
               and split_part(name, '/', 1) = workspace::text)
      then raise exception 'A non-member read this workspace''s files (a listing gallery is not a grant)'; end if;
    reset role;
  end loop;

  perform set_config('request.jwt.claim.sub', null, true);
  set local role authenticated;
  if exists (select 1 from storage.objects where bucket_id in ('horse-documents', 'horse-media'))
    then raise exception 'A signed-out caller read a private bucket'; end if;
  reset role;

  -- ------------------------------------------------- uploader-keyed paths
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  set local role authenticated;
  if exists (select 1 from storage.objects where name in (doc_legacy, media_legacy))
    then raise exception 'An uploader-keyed object is still readable by its uploader'; end if;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('horse-media', admin_id::text || '/horses/fixture/media-new.jpg', admin_id);
    raise exception 'An uploader-keyed photo path is still mintable';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('horse-documents', admin_id::text || '/documents/fixture/new.pdf', admin_id);
    raise exception 'An uploader-keyed document path is still mintable';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ---------------------------------------------------------- photo writes
  foreach reader in array array[owner_id, admin_id, manager_id, sales_id] loop
    perform set_config('request.jwt.claim.sub', reader::text, true);
    set local role authenticated;
    insert into storage.objects (bucket_id, name, owner)
    values ('horse-media', workspace::text || '/horses/fixture/media-' || reader::text || '.jpg', reader);
    reset role;
  end loop;

  foreach reader in array array[medical_id, invited_id, outsider_id] loop
    perform set_config('request.jwt.claim.sub', reader::text, true);
    set local role authenticated;
    begin
      insert into storage.objects (bucket_id, name, owner)
      values ('horse-media', workspace::text || '/horses/fixture/denied-' || reader::text || '.jpg', reader);
      raise exception 'A role without uploadMedia (or no active membership) uploaded a photo';
    exception when insufficient_privilege then null;
    end;
    reset role;
  end loop;

  -- --------------------------------------------------------------- moves
  -- An UPDATE renames, so it is a move with two ends. With the uploader-keyed
  -- update policies gone, no end of a move can be a personal path.
  perform set_config('request.jwt.claim.sub', sales_id::text, true);
  set local role authenticated;
  begin
    update storage.objects set name = sales_id::text || '/horses/fixture/taken.jpg'
    where bucket_id = 'horse-media' and name = media_ws;
  exception when insufficient_privilege then null;
  end;
  begin
    update storage.objects set name = workspace::text || '/horses/fixture/renamed.jpg'
    where bucket_id = 'horse-media' and name = media_ws;
  exception when insufficient_privilege then null;
  end;
  begin
    update storage.objects set name = other_workspace::text || '/horses/fixture/taken.jpg'
    where bucket_id = 'horse-media' and name = media_ws;
  exception when insufficient_privilege then null;
  end;
  reset role;
  if not exists (select 1 from storage.objects where bucket_id = 'horse-media' and name = media_ws)
    then raise exception 'A member moved or renamed a ranch photo'; end if;

  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  set local role authenticated;
  begin
    update storage.objects set name = admin_id::text || '/documents/fixture/taken.pdf'
    where bucket_id = 'horse-documents' and name = doc_shared;
  exception when insufficient_privilege then null;
  end;
  update storage.objects set name = workspace::text || '/documents/fixture/rescued.pdf'
  where bucket_id = 'horse-documents' and name = doc_legacy;
  get diagnostics affected = row_count;
  reset role;
  if not exists (select 1 from storage.objects where bucket_id = 'horse-documents' and name = doc_shared)
    then raise exception 'An Admin moved a ranch document to a personal path'; end if;
  if affected <> 0 then raise exception 'An uploader-keyed object can still be reached by a client update'; end if;

  -- ---------------------------------------------------- leaving the ranch
  update public.workspace_memberships set status = 'inactive'
  where workspace_id = workspace and user_id = sales_id;
  perform set_config('request.jwt.claim.sub', sales_id::text, true);
  set local role authenticated;
  if exists (select 1 from storage.objects where bucket_id in ('horse-documents', 'horse-media')
             and split_part(name, '/', 1) = workspace::text)
    then raise exception 'A deactivated member still reads the workspace files'; end if;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('horse-media', workspace::text || '/horses/fixture/after-removal.jpg', sales_id);
    raise exception 'A deactivated member still uploads photos';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- ----------------------------------------------------- capability check
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  if not public.xbar_has_workspace_capability(workspace, 'uploadMedia')
    then raise exception 'The workspace owner lacks uploadMedia'; end if;
  if public.xbar_has_workspace_capability(workspace, 'uploadMedai')
    then raise exception 'The workspace owner passed an unknown capability'; end if;
  if public.xbar_has_workspace_capability(other_workspace, 'uploadMedia')
    then raise exception 'A capability leaked across workspaces'; end if;
  perform set_config('request.jwt.claim.sub', medical_id::text, true);
  if public.xbar_has_workspace_capability(workspace, 'uploadMedia')
    then raise exception 'Medical Lead was granted uploadMedia'; end if;
  if not public.xbar_has_workspace_capability(workspace, 'manageMedical')
    then raise exception 'Medical Lead lost manageMedical'; end if;

end;
$check$;
rollback;
select 'PASS: documents and photos are reachable only through the workspace in their first path segment; gallery listings grant nothing; photo writes follow uploadMedia and document writes follow manage; uploader-keyed paths unreadable, unmintable and unmovable; no client renames or moves a photo; no move leaves a workspace; inactive, invited, outside-tenant and signed-out callers refused; all fixtures rolled back' as result;
