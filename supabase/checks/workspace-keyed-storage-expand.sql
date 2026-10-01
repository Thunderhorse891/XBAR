-- Administrative connection only; everything is rolled back. Run after
-- 20261001090000 (expand) and BEFORE 20261001090100 (contract).
--
-- What the expand window must already guarantee, while uploader-keyed
-- branches still exist for tabs on the previous bundle:
--   * a gallery that LISTS another ranch's photo grants nothing;
--   * members read their workspace's photos, and photo writes follow uploadMedia;
--   * a tab on the old bundle can still upload and see its own photo;
--   * no UPDATE moves a ranch file out of its workspace. Permissive policies
--     OR their USING and WITH CHECK clauses separately, so an uploader-keyed
--     UPDATE policy beside a workspace one would let a member rename a ranch
--     photo to `<their id>/...` -- a path they keep after leaving.
begin;
do $check$
declare
  owner_id uuid := gen_random_uuid();
  sales_id uuid := gen_random_uuid();
  medical_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  workspace uuid := gen_random_uuid();
  other_workspace uuid := gen_random_uuid();
  media_ws text;
  doc_ws text;
begin
  media_ws := workspace::text || '/horses/fixture/media-1.jpg';
  doc_ws := workspace::text || '/documents/fixture/coggins.pdf';

  insert into auth.users (id, email, email_confirmed_at)
  select id, id::text || '@example.invalid', now()
  from unnest(array[owner_id, sales_id, medical_id, outsider_id]) as id;
  insert into public.workspaces (id, owner_user_id, workspace_key) values
    (workspace, owner_id, workspace::text),
    (other_workspace, outsider_id, other_workspace::text);
  insert into public.workspace_memberships (workspace_id, user_id, email, role, status) values
    (workspace, sales_id, sales_id::text || '@example.invalid', 'Sales Lead', 'active'),
    (workspace, medical_id, medical_id::text || '@example.invalid', 'Medical Lead', 'active'),
    (other_workspace, outsider_id, outsider_id::text || '@example.invalid', 'Admin', 'active');
  insert into storage.objects (bucket_id, name, owner) values
    ('horse-media', media_ws, owner_id),
    ('horse-documents', doc_ws, owner_id);
  insert into public.horses (workspace_id, horse_id, name, payload) values (
    other_workspace, 'check-horse', 'Check Horse',
    jsonb_build_object('gallery', jsonb_build_array(jsonb_build_object('storagePath', media_ws, 'status', 'Approved')))
  );

  -- A gallery listing is not a grant.
  perform set_config('request.jwt.claim.sub', outsider_id::text, true);
  set local role authenticated;
  if exists (select 1 from storage.objects where bucket_id = 'horse-media' and name = media_ws)
    then raise exception 'Another ranch read a photo by listing it in its own gallery'; end if;
  reset role;

  -- Members read; uploadMedia writes; Medical Lead does not.
  perform set_config('request.jwt.claim.sub', medical_id::text, true);
  set local role authenticated;
  if not exists (select 1 from storage.objects where bucket_id = 'horse-media' and name = media_ws)
    then raise exception 'A member cannot read a workspace photo'; end if;
  begin
    insert into storage.objects (bucket_id, name, owner)
    values ('horse-media', workspace::text || '/horses/fixture/by-medical.jpg', medical_id);
    raise exception 'Medical Lead uploaded a photo without uploadMedia';
  exception when insufficient_privilege then null;
  end;
  reset role;

  perform set_config('request.jwt.claim.sub', sales_id::text, true);
  set local role authenticated;
  insert into storage.objects (bucket_id, name, owner)
  values ('horse-media', workspace::text || '/horses/fixture/by-sales.jpg', sales_id);
  -- A tab on the previous bundle still uploads under its own id, and sees it.
  insert into storage.objects (bucket_id, name, owner)
  values ('horse-media', sales_id::text || '/horses/fixture/old-tab.jpg', sales_id);
  if not exists (select 1 from storage.objects where name = sales_id::text || '/horses/fixture/old-tab.jpg')
    then raise exception 'An old-bundle upload is not visible to its uploader during the expand window'; end if;

  -- No move out of the ranch, in either bucket.
  begin
    update storage.objects set name = sales_id::text || '/horses/fixture/taken.jpg'
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
    then raise exception 'A member moved a ranch photo out of its workspace during the expand window'; end if;

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  set local role authenticated;
  begin
    update storage.objects set name = owner_id::text || '/documents/fixture/taken.pdf'
    where bucket_id = 'horse-documents' and name = doc_ws;
  exception when insufficient_privilege then null;
  end;
  reset role;
  if not exists (select 1 from storage.objects where bucket_id = 'horse-documents' and name = doc_ws)
    then raise exception 'A ranch document was moved to a personal path during the expand window'; end if;
end;
$check$;
rollback;
select 'PASS (expand window): gallery listings grant nothing; members read workspace photos; uploadMedia gates writes; old-bundle uploads still work for their uploader; no move leaves a workspace; all fixtures rolled back' as result;
