-- Workspace-keyed storage, CONTRACT phase (audit F02). Apply only after the
-- client that writes `<workspace id>/horses/...` photos is live and the expand
-- phase (20261001090000) is applied.
--
-- Removes every uploader-keyed branch from both private buckets, so a file is
-- reachable only through the workspace named by its first path segment:
--
--   * horse-media: "horse media upload own" / "horse media update own", and
--     the uploader branch of "horse media select workspace".
--   * horse-documents: "horse documents read own" / "upload own" / "update
--     own" (the expansion-phase policies), AND the `or auth.uid() = first
--     segment` branches that 20260912060000 builds into "horse documents
--     select workspace" and "horse documents update workspace". Whichever of
--     those two states a database is in, it leaves this file in the same one.
--
-- Why: an uploader-keyed object stays readable by its uploader after they
-- leave the ranch, and it can belong to a different workspace than the
-- documents row that points at it.
--
-- Data: no object is moved, rewritten or deleted. Check first that no object
-- in either bucket is still uploader-keyed (README step 11 has the query); an
-- object that is would become unreadable to its uploader, though the workspace
-- policies never granted it to anyone else.

begin;

-- horse-media ------------------------------------------------------------

drop policy if exists "horse media upload own" on storage.objects;
drop policy if exists "horse media update own" on storage.objects;

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

-- horse-documents ----------------------------------------------------------

drop policy if exists "horse documents read own" on storage.objects;
drop policy if exists "horse documents upload own" on storage.objects;
drop policy if exists "horse documents update own" on storage.objects;

drop policy if exists "horse documents select workspace" on storage.objects;
create policy "horse documents select workspace" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'horse-documents'
    and case
      when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then public.xbar_has_workspace_access(split_part(name, '/', 1)::uuid)
      else false
    end
  );

-- MANAGE on both ends of an update: an UPDATE can rename an object across the
-- bucket, so guarding only the destination lets a plain member of A move A's
-- file into a workspace they manage (see 20260912060000).
drop policy if exists "horse documents update workspace" on storage.objects;
create policy "horse documents update workspace" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'horse-documents'
    and case
      when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then public.xbar_can_manage_workspace(split_part(name, '/', 1)::uuid)
      else false
    end
  )
  with check (
    bucket_id = 'horse-documents'
    and case
      when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then public.xbar_can_manage_workspace(split_part(name, '/', 1)::uuid)
      else false
    end
  );

commit;
