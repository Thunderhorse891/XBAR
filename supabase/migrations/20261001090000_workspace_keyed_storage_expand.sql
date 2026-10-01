-- Workspace-keyed storage, EXPAND phase (audit F02). Safe to apply before the
-- client that writes `<workspace id>/horses/...` photos is deployed: every
-- client already in use keeps working, and the new one works too.
--
-- What this closes now: horse-media granted a read to anyone whose workspace
-- gallery LISTED the object's path. A gallery is owner-editable JSON, so the
-- owner of workspace B could list workspace A's photo path in B's gallery and
-- read A's photo. That branch is removed here.
--
-- What it adds: horse-media reads for members of the workspace named by the
-- first path segment, and writes for the workspace owner and members whose
-- role holds `uploadMedia` in the app's role matrix (Admin, Ranch Manager,
-- Sales Lead) -- the people the app already lets upload photos.
--
-- What it keeps, until the CONTRACT phase (20261001090100): the uploader-keyed
-- `<user id>/...` read/write branches, so a browser tab still running the
-- previous bundle can upload and see its photo until it reloads.
--
-- xbar_has_workspace_capability is that role matrix in the database. It is a
-- third copy of src/lib/permissions.ts (api/_lib/permissions.js is the second),
-- and tests/api/permissionsParity.test.mjs compares it with both: a comment
-- saying "keep in sync" is not a mechanism. An unknown capability is refused
-- for everyone, the workspace owner included.
--
-- Data: no object is moved, rewritten or deleted.

begin;

create or replace function public.xbar_has_workspace_capability(p_workspace_id uuid, p_capability text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with role_grants(role, capability) as (
    values
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
  )
  select
    -- The workspace owner holds every capability the matrix knows, as an
    -- Admin does -- and no capability it does not know.
    (
      exists (select 1 from role_grants g where g.role = 'Admin' and g.capability = p_capability)
      and exists (
        select 1 from public.workspaces w
        where w.id = p_workspace_id and w.owner_user_id = auth.uid()
      )
    )
    or exists (
      select 1
      from public.workspace_memberships m
      join role_grants g on g.role = m.role
      where m.workspace_id = p_workspace_id
        and m.user_id = auth.uid()
        and m.status = 'active'
        and g.capability = p_capability
    );
$$;

revoke all on function public.xbar_has_workspace_capability(uuid, text) from public;
revoke all on function public.xbar_has_workspace_capability(uuid, text) from anon;
grant execute on function public.xbar_has_workspace_capability(uuid, text) to authenticated;

-- horse-media read: the workspace named by the first segment. The gallery
-- branch is gone; the uploader branch stays until the contract phase.
drop policy if exists "horse media select workspace" on storage.objects;
create policy "horse media select workspace" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'horse-media'
    and (
      case
        when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
          then public.xbar_has_workspace_access(split_part(name, '/', 1)::uuid)
        else false
      end
      -- Removed in 20261001090100 (contract phase).
      or (select auth.uid())::text = split_part(name, '/', 1)
    )
  );

-- horse-media write: alongside the existing "horse media upload own" and
-- "horse media update own", which the contract phase drops.
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

commit;
