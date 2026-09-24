-- horse-media goes private: signed URLs replace public URLs.
--
-- THE DEFECT. `horse-media` was created PUBLIC
-- (supabase/production-schema.sql), and `uploadMediaAssetToCloud` minted a
-- permanent public URL for every upload. Anyone holding or guessing a media
-- URL could open a horse's photos with no workspace membership and no share
-- token: on a private-token listing the token gated the page while the images
-- themselves were one URL away from the open internet. The horse-documents
-- bucket was already private + signed URLs; this brings horse-media to the
-- same posture.
--
-- WHAT CHANGES.
--   1. The bucket flips to private. Existing public URLs stop resolving.
--   2. Reads are granted to (a) the uploader, via the existing first-segment
--      `<uploader-uuid>/horses/<horse>/<file>` path shape, and (b) any
--      authenticated workspace member, via the horse row's gallery: an object
--      is readable when some horse in a workspace the caller may access lists
--      that exact storage path in `payload -> 'gallery'`. The gallery array is
--      the canonical media-to-horse link, so the policy matches the full path
--      instead of trusting path segments -- no id parsing, no sanitization
--      assumptions, no UUID casts on client text.
--   3. Writes are untouched. The existing "horse media upload own" /
--      "horse media update own" policies stay: uploads remain keyed to the
--      uploader and keep working through the same client call.
--
-- ONE DEFINITION OF ACCESS. Workspace membership is checked with
-- `public.xbar_has_workspace_access`, the same security-definer function the
-- `public.horses` row policies use -- not a second inline membership query
-- that could disagree with it.
--
-- ANONYMOUS BUYERS. There is intentionally no anon SELECT policy. Buyers on a
-- shared listing are anonymous + token, not workspace members; they receive
-- short-lived signed URLs minted server-side by `api/buyer/media` (service
-- role), which authorizes each request against the listing's share token via
-- the same `xbar_resolve_public_listing` RPC the buyer page uses, and only
-- signs storage paths present in that listing's horse gallery.
--
-- DELETE stays unpoliced, and so stays denied. The application never removes a
-- media object; account deletion runs server-side with the service role and is
-- unaffected by these policies.
--
-- ROLLBACK (Erin's explicit ops approval required, per contract #15 -- this
-- file only WRITES the migration; it must not be applied without her word):
--   update storage.buckets set public = true where id = 'horse-media';
--   drop policy if exists "horse media select workspace" on storage.objects;
-- Rolling back restores the old public URLs. The new client code keeps
-- working either way: createSignedUrl succeeds on a public bucket too. Roll
-- the client back first only if the old getPublicUrl behavior is wanted.
-- This migration is re-runnable: it drops the policy by name before creating
-- it and rewrites no rows.
--
-- KNOWN RESIDUAL. A workspace member can read a horse's media only once the
-- horse row carrying that media's storagePath in its gallery has synced to
-- the cloud. Media uploaded moments ago on a device whose sync has not run
-- yet is readable by the uploader only -- the same posture documents have.

-- 1. The bucket goes private. Public URLs stop resolving the moment this runs.
update storage.buckets
set public = false
where id = 'horse-media';

-- 2. Members read their workspace's horse media; the uploader keeps reading
--    their own objects. No anon access: buyers go through api/buyer/media.
drop policy if exists "horse media select workspace" on storage.objects;

create policy "horse media select workspace"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'horse-media'
  and (
    -- Objects the caller uploaded themselves (current and legacy path shape).
    auth.uid()::text = split_part(name, '/', 1)
    -- Objects referenced by the gallery of a horse in a workspace the caller
    -- may access. Matches the exact storage path recorded on the horse row,
    -- so readability follows the record the workspace already shares rather
    -- than the shape of the object key.
    or exists (
      select 1
      from public.horses h
      -- jsonb_array_elements THROWS on a non-array; a single corrupt gallery
      -- value would turn this policy from a denial into an RLS error (an
      -- outage for every member read), so the shape guard comes first and
      -- skips the row instead of erroring.
      where public.xbar_has_workspace_access(h.workspace_id)
        and jsonb_typeof(h.payload -> 'gallery') = 'array'
        and exists (
          select 1
          from jsonb_array_elements(h.payload -> 'gallery') as g(asset)
          where g.asset ->> 'storagePath' = storage.objects.name
        )
    )
  )
);
