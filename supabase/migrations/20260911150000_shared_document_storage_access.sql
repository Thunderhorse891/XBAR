-- Let a workspace's members open the documents that workspace's records name.
--
-- `horse documents read own` (production-schema.sql) authorizes a private
-- storage object by its PATH PREFIX:
--
--   auth.uid()::text = split_part(name, '/', 1)
--
-- and client uploads are written to `${uploader}/documents/${horse}/${file}`
-- (src/lib/cloudWorkspace.ts uploadDocumentAssetToCloud). The document RECORD,
-- however, is authorized by WORKSPACE (`documents own workspace`). The two
-- disagree for every member who is not the uploader: measured on PostgreSQL
-- 16.13 with both policies verbatim, an active member of the same workspace saw
-- the document row -- storage_path included -- and ZERO storage objects. The app
-- opens files with `createSignedUrl` under the customer's own JWT
-- (cloudWorkspace.ts getDocumentAccessUrl), and a signed URL requires select on
-- the object, so a shared ranch's documents could be listed by every member and
-- opened by none but the person who uploaded them.
--
-- This ADDS a second read path; it does not replace the uploader's. Access is
-- granted only where a document row in a workspace the caller can reach names
-- this exact object, so it can never reach an object no record points at, and it
-- reuses `xbar_has_workspace_access` (security definer, `set search_path =
-- public`) rather than restating the membership rule.
--
-- Rollback: drop the policy added here. That restores the uploader-only read
-- and re-closes shared documents to everyone else.

-- `create policy if not exists` is not PostgreSQL syntax; production-schema.sql
-- only gets away with it because scripts/prepare-supabase-schema.mjs rewrites
-- that form, and it rewrites the SCHEMA alone -- migrations are concatenated
-- verbatim. Drop-then-create is the idiom the other migrations use, and it also
-- makes this file re-runnable.
drop policy if exists "horse documents read in workspace" on storage.objects;

create policy "horse documents read in workspace"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'horse-documents'
  and exists (
    select 1
    from public.documents d
    where d.storage_path = storage.objects.name
      and public.xbar_has_workspace_access(d.workspace_id)
  )
);
