-- Expand phase: deploy BEFORE the workspace-path client.
-- Retain existing uploader policies so the older production client keeps working.
-- The later 20260912060000 migration is the contract phase; apply it only after
-- retiring older upload clients. This phase neither moves files nor grants DELETE.
-- Workspace authorization uses the same server-owned membership rules as records.
drop policy if exists "horse documents insert workspace" on storage.objects;
drop policy if exists "horse documents select workspace" on storage.objects;
drop policy if exists "horse documents update workspace" on storage.objects;

create policy "horse documents insert workspace" on storage.objects
for insert to authenticated with check (
  bucket_id = 'horse-documents'
  and case when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then public.xbar_can_manage_workspace(split_part(name, '/', 1)::uuid)
    else false end
);
create policy "horse documents select workspace" on storage.objects
for select to authenticated using (
  bucket_id = 'horse-documents'
  and case when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then public.xbar_has_workspace_access(split_part(name, '/', 1)::uuid)
    else false end
);
create policy "horse documents update workspace" on storage.objects
for update to authenticated using (
  bucket_id = 'horse-documents'
  and case when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then public.xbar_can_manage_workspace(split_part(name, '/', 1)::uuid)
    else false end
) with check (
  bucket_id = 'horse-documents'
  and case when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    then public.xbar_can_manage_workspace(split_part(name, '/', 1)::uuid)
    else false end
);

-- Assert the deployed policies under real authenticated RLS. The inner
-- subtransaction always rolls back every fixture, including auth users.
-- Any unexpected assertion aborts the migration instead of being swallowed.
do $verify$
declare
  owner_id uuid := gen_random_uuid();
  admin_id uuid := gen_random_uuid();
  reader_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  workspace uuid := gen_random_uuid();
  other_workspace uuid := gen_random_uuid();
  shared_path text := workspace::text || '/documents/rollout/shared.pdf';
  legacy_path text := admin_id::text || '/documents/rollout/legacy.pdf';
  affected integer;
begin
  begin
    insert into auth.users (id, email, email_confirmed_at) values
      (owner_id, owner_id::text || '@example.invalid', now()),
      (admin_id, admin_id::text || '@example.invalid', now()),
      (reader_id, reader_id::text || '@example.invalid', now()),
      (outsider_id, outsider_id::text || '@example.invalid', now());
    insert into public.workspaces (id, owner_user_id, workspace_key) values
      (workspace, owner_id, workspace::text),
      (other_workspace, outsider_id, other_workspace::text);
    insert into public.workspace_subscription_profiles (workspace_id, tier, billing_state)
      values (workspace, 'Professional', 'Manual Billing');
    insert into public.workspace_memberships (workspace_id, user_id, email, role, status) values
      (workspace, admin_id, admin_id::text || '@example.invalid', 'Admin', 'active'),
      (workspace, reader_id, reader_id::text || '@example.invalid', 'Ranch Manager', 'active');

    perform set_config('request.jwt.claim.sub', admin_id::text, true);
    set local role authenticated;
    -- Both new and old clients still upload.
    insert into storage.objects (bucket_id, name, owner) values
      ('horse-documents', shared_path, admin_id),
      ('horse-documents', legacy_path, admin_id);
    if (select count(*) from storage.objects where bucket_id='horse-documents'
        and name in (shared_path, legacy_path)) <> 2
      then raise exception 'Uploader cannot read both path formats'; end if;
    begin
      insert into storage.objects (bucket_id, name, owner)
        values ('horse-documents', other_workspace::text || '/documents/forged.pdf', admin_id);
      raise exception 'Cross-tenant upload accepted';
    exception when insufficient_privilege then null;
    end;
    begin
      insert into storage.objects (bucket_id, name, owner)
        values ('horse-documents', 'not-a-uuid/documents/invalid.pdf', admin_id);
      raise exception 'Malformed path accepted';
    exception when insufficient_privilege then null;
    end;
    begin
      update storage.objects set name=other_workspace::text || '/documents/moved.pdf'
        where bucket_id='horse-documents' and name=shared_path;
      raise exception 'Cross-tenant move accepted';
    exception when insufficient_privilege then null;
    end;
    begin
      delete from storage.objects where bucket_id='horse-documents' and name=shared_path;
      get diagnostics affected = row_count;
      if affected <> 0 then raise exception 'Client delete unexpectedly allowed'; end if;
    exception when insufficient_privilege then
      -- Managed Storage also rejects SQL deletion before row-policy evaluation.
      null;
    end;
    reset role;

    -- Workspace owners do not need a redundant membership row.
    perform set_config('request.jwt.claim.sub', owner_id::text, true);
    set local role authenticated;
    insert into storage.objects (bucket_id, name, owner)
      values ('horse-documents', workspace::text || '/documents/owner.pdf', owner_id);
    reset role;

    perform set_config('request.jwt.claim.sub', reader_id::text, true);
    set local role authenticated;
    if (select count(*) from storage.objects where bucket_id='horse-documents' and name=shared_path) <> 1
      then raise exception 'Active reader cannot read workspace object'; end if;
    if exists (select 1 from storage.objects where bucket_id='horse-documents' and name=legacy_path)
      then raise exception 'Legacy object leaked to teammate'; end if;
    begin
      insert into storage.objects (bucket_id, name, owner)
        values ('horse-documents', workspace::text || '/documents/reader.pdf', reader_id);
      raise exception 'Read-only member uploaded workspace object';
    exception when insufficient_privilege then null;
    end;
    update storage.objects set name=workspace::text || '/documents/renamed.pdf'
      where bucket_id='horse-documents' and name=shared_path;
    get diagnostics affected = row_count;
    if affected <> 0 then raise exception 'Reader changed workspace object'; end if;
    reset role;

    perform set_config('request.jwt.claim.sub', outsider_id::text, true);
    set local role authenticated;
    if exists (select 1 from storage.objects where bucket_id='horse-documents'
        and name in (shared_path, legacy_path))
      then raise exception 'Outside tenant read private object'; end if;
    reset role;
    perform set_config('request.jwt.claim.sub', '', true);
    set local role authenticated;
    if exists (select 1 from storage.objects where bucket_id='horse-documents'
        and name=shared_path)
      then raise exception 'Signed-out caller read private object'; end if;
    reset role;

    update public.workspace_memberships set status='inactive'
      where workspace_id=workspace and user_id=reader_id;
    perform set_config('request.jwt.claim.sub', reader_id::text, true);
    set local role authenticated;
    if exists (select 1 from storage.objects where bucket_id='horse-documents' and name=shared_path)
      then raise exception 'Inactive member retained workspace access'; end if;
    reset role;
    raise exception using errcode='ZX001', message='Rollback successful verification fixtures';
  exception when sqlstate 'ZX001' then
    null;
  end;
end
$verify$;
