-- Every private object is filed under its workspace, and only that workspace
-- can reach it.
--
-- horse-media granted a read to anyone whose workspace gallery LISTED the
-- object's path. A gallery is owner-editable JSON, so an owner of workspace B
-- could list workspace A's photo path in B's gallery and read A's photo. The
-- uploader-keyed branches (horse-media and the legacy horse-documents
-- policies) let a member upload outside any workspace and keep reading files
-- after leaving it.
--
-- After this migration a horse-media or horse-documents object is readable by
-- members of the workspace named by its first path segment. horse-media is
-- writable by the workspace owner and by members whose role holds
-- `uploadMedia` in the app's role matrix (Admin, Ranch Manager, Sales Lead) --
-- the people the app already lets upload photos, who could do so before this
-- migration through the uploader-keyed policy. Audit F02.
--
-- xbar_has_workspace_capability is that role matrix in the database. It is a
-- third copy of src/lib/permissions.ts (api/_lib/permissions.js is the second),
-- and tests/api/permissionsParity.test.mjs compares it with both: a comment
-- saying "keep in sync" is not a mechanism.
--
-- Data: no object is moved, rewritten or deleted. At the time of writing the
-- horse-media bucket is empty and every horse-documents object is already
-- workspace-keyed, so no existing file loses a reader.

begin;

create or replace function public.xbar_has_workspace_capability(p_workspace_id uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = p_workspace_id and w.owner_user_id = auth.uid()
  ) or exists (
    select 1
    from public.workspace_memberships m
    join (values
      ('Admin', 'createHorse'),
      ('Admin', 'editHorse'),
      ('Admin', 'uploadDocuments'),
      ('Admin', 'reviewDocuments'),
      ('Admin', 'uploadMedia'),
      ('Admin', 'manageMedical'),
      ('Admin', 'manageBreeding'),
      ('Admin', 'manageSales'),
      ('Admin', 'manageOwnership'),
      ('Admin', 'manageAssets'),
      ('Admin', 'manageSharedAccess'),
      ('Admin', 'manageSettings'),
      ('Admin', 'manageBilling'),
      ('Admin', 'syncCloud'),
      ('Ranch Manager', 'createHorse'),
      ('Ranch Manager', 'editHorse'),
      ('Ranch Manager', 'uploadDocuments'),
      ('Ranch Manager', 'uploadMedia'),
      ('Ranch Manager', 'manageMedical'),
      ('Ranch Manager', 'manageAssets'),
      ('Ranch Manager', 'manageSharedAccess'),
      ('Owner', 'editHorse'),
      ('Owner', 'uploadDocuments'),
      ('Owner', 'reviewDocuments'),
      ('Owner', 'manageMedical'),
      ('Owner', 'syncCloud'),
      ('Medical Lead', 'uploadDocuments'),
      ('Medical Lead', 'reviewDocuments'),
      ('Medical Lead', 'manageMedical'),
      ('Sales Lead', 'editHorse'),
      ('Sales Lead', 'uploadDocuments'),
      ('Sales Lead', 'uploadMedia'),
      ('Sales Lead', 'manageSales'),
      ('Sales Lead', 'manageSharedAccess')
    ) as role_grants(role, capability) on role_grants.role = m.role
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and role_grants.capability = p_capability
  );
$$;

revoke all on function public.xbar_has_workspace_capability(uuid, text) from public;
revoke all on function public.xbar_has_workspace_capability(uuid, text) from anon;
grant execute on function public.xbar_has_workspace_capability(uuid, text) to authenticated;

-- horse-media: replace the gallery/uploader read with a workspace read.
drop policy if exists "horse media select workspace" on storage.objects;
create policy "horse media select workspace" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'horse-media'
    and case
      when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then public.xbar_has_workspace_access(split_part(name, '/', 1)::uuid)
      else false
    end
  );

drop policy if exists "horse media upload own" on storage.objects;
drop policy if exists "horse media insert workspace" on storage.objects;
create policy "horse media insert workspace" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'horse-media'
    and case
      when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then public.xbar_has_workspace_capability(split_part(name, '/', 1)::uuid, 'uploadMedia')
      else false
    end
  );

drop policy if exists "horse media update own" on storage.objects;
drop policy if exists "horse media update workspace" on storage.objects;
create policy "horse media update workspace" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'horse-media'
    and case
      when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then public.xbar_has_workspace_capability(split_part(name, '/', 1)::uuid, 'uploadMedia')
      else false
    end
  )
  with check (
    bucket_id = 'horse-media'
    and case
      when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then public.xbar_has_workspace_capability(split_part(name, '/', 1)::uuid, 'uploadMedia')
      else false
    end
  );

-- horse-documents: the workspace policies stay; the uploader-keyed legacy
-- branches go. No object in this bucket uses the uploader-keyed layout.
drop policy if exists "horse documents read own" on storage.objects;
drop policy if exists "horse documents upload own" on storage.objects;
drop policy if exists "horse documents update own" on storage.objects;

commit;
