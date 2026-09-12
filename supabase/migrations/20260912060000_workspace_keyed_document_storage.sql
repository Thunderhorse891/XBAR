-- Shared documents are unreadable by anyone but the uploader. This fixes that.
--
-- THE DEFECT. `horse-documents` is a PRIVATE bucket, and its policies keyed the
-- first path segment to `auth.uid()`, while rows in `public.documents` are
-- scoped to a WORKSPACE. So a file uploaded by one member was listed for every
-- member and openable by none of them but the uploader: the row was there, and
-- the signed-URL request was refused. For a product whose whole promise is a
-- shared ranch record, a document only its uploader can open is not a shared
-- document at all.
--
-- ONE DEFINITION OF ACCESS, NOT TWO. The row policies on `public.documents` say
-- who may read a document (`public.xbar_has_workspace_access`) and who may write
-- one (`public.xbar_can_manage_workspace`). This migration hands the object
-- policies the SAME two functions rather than re-deriving membership inline,
-- because the bug being fixed here IS a second definition of access that
-- disagreed with the first. An inline `exists (... workspace_memberships ...)`
-- would have read almost the same and still differed: it would lock out a
-- workspace owner who has no membership row of their own, and it would let a
-- non-Admin member write an object whose `public.documents` row the very next
-- statement refuses -- an orphan in a private bucket with nothing pointing at
-- it. Those functions are `security definer`, so they also do not depend on the
-- caller being able to SELECT the membership row through its own RLS.
--
-- WHAT A MEMBER LOSES. Nothing they could actually use. A non-Admin member may
-- upload an object today, and then cannot insert the `public.documents` row that
-- makes it a document. Refusing that upload is the same outcome reported one
-- step earlier, at the point the customer can still understand it.
--
-- NEVER CAST CLIENT TEXT. `split_part(name,'/',1)` is arbitrary text supplied by
-- whoever names the object; `::uuid` on it raises 22P02 for anything that is not
-- a UUID, and a policy that throws is an outage rather than a denial -- one
-- badly named object would break listing for everybody. The cast therefore sits
-- inside a `case` guarded by a UUID-shaped regex: `case` is the one construct
-- Postgres guarantees will not evaluate its branches out of order, which a plain
-- `and` does not. A segment that is not UUID-shaped simply grants nothing.
--
-- LEGACY OBJECTS. Everything uploaded before this is at `<uploader-uuid>/...`.
-- SELECT keeps honouring that shape for the uploader, so nothing that works
-- today stops working. INSERT does NOT: a new object may only be written under a
-- workspace the caller may manage, or the bug would keep minting unreadable
-- files. Existing objects are not rewritten here -- moving tenant data is a
-- separate, reversible operation, and silently relocating it during a schema
-- migration is how storage gets orphaned.
--
-- DELETE stays unpoliced, and so stays denied. The application never removes an
-- object, and widening deletion is not part of fixing a read.

drop policy if exists "horse documents upload own" on storage.objects;
drop policy if exists "horse documents read own" on storage.objects;
drop policy if exists "horse documents update own" on storage.objects;
drop policy if exists "horse documents insert workspace" on storage.objects;
drop policy if exists "horse documents select workspace" on storage.objects;
drop policy if exists "horse documents update workspace" on storage.objects;

create policy "horse documents insert workspace"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'horse-documents'
  and case
    when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then public.xbar_can_manage_workspace(split_part(name, '/', 1)::uuid)
    else false
  end
);

create policy "horse documents select workspace"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'horse-documents'
  and (
    case
      when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then public.xbar_has_workspace_access(split_part(name, '/', 1)::uuid)
      else false
    end
    -- Objects written under the previous scheme stay readable by the person who
    -- uploaded them, so this migration takes nothing away from anyone.
    or auth.uid()::text = split_part(name, '/', 1)
  )
);

create policy "horse documents update workspace"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'horse-documents'
  and (
    case
      when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
        then public.xbar_has_workspace_access(split_part(name, '/', 1)::uuid)
      else false
    end
    or auth.uid()::text = split_part(name, '/', 1)
  )
)
with check (
  -- The destination is workspace-only even when the source was a legacy path:
  -- an update must never be a way to move an object into a namespace the caller
  -- does not belong to, nor to keep minting uploader-keyed objects.
  bucket_id = 'horse-documents'
  and case
    when split_part(name, '/', 1) ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then public.xbar_can_manage_workspace(split_part(name, '/', 1)::uuid)
    else false
  end
);
