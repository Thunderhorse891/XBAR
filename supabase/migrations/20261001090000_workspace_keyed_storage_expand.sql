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
-- `<user id>/...` read and INSERT branches, so a browser tab still running the
-- previous bundle can upload and see its photo until it reloads. Such a photo
-- is visible only to its uploader in that window; production holds no media
-- objects at the time of writing, so the window costs nobody an existing file.
--
-- What it drops now: the uploader-keyed UPDATE policies on both buckets, and
-- it adds no UPDATE policy for photos. No client renames or moves a stored
-- photo (uploads are insert-only, upsert false), and an UPDATE on
-- storage.objects is a move: beside a workspace policy, "update own" let a
-- member move a ranch file to `<their id>/...` (Postgres ORs permissive USING
-- and WITH CHECK separately), and any photo UPDATE grant lets a non-manager
-- rename a ranch photo out from under its gallery -- a delete by another name,
-- where DELETE is deliberately granted to no one.
--
-- Buyer photos: the public listing resolver now also returns the listing's
-- workspace id, from the same row it returns the gallery from. The server
-- signs a buyer photo only when the photo lives under that workspace, so it
-- never has to work out a second time which ranch a share link means. Buyers
-- already receive that id as the first segment of every photo path.
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
-- branch is gone. The uploader branch stays only while the uploader-keyed
-- upload policy does -- i.e. until the contract phase -- so re-running this
-- file after 20261001090100 cannot quietly put that branch back.
drop policy if exists "horse media select workspace" on storage.objects;
do $media_read$
begin
  if exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'horse media upload own'
  ) then
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
  else
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
  end if;
end;
$media_read$;

-- horse-media insert: alongside the existing "horse media upload own", which
-- the contract phase drops.
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

-- No UPDATE policy for photos (see header).
drop policy if exists "horse media update workspace" on storage.objects;
drop policy if exists "horse media update own" on storage.objects;
drop policy if exists "horse documents update own" on storage.objects;

-- Public listing resolver: return the listing's workspace -----------------
-- Identical to 20260911003739 except for the added `workspaceId`. CREATE OR
-- REPLACE keeps the function's existing grants.
create or replace function public.xbar_resolve_public_listing_legacy(
  p_share_path text,
  p_share_token text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  listing_row record;
  horse_payload jsonb;
  ownership_payload jsonb;
  document_payloads jsonb;
begin
  select
    sl.workspace_id,
    sl.listing_id,
    sl.horse_id,
    sl.share_path,
    coalesce(nullif(sl.access_mode, ''), 'Private Token') as access_mode,
    coalesce(sl.share_token, '') as share_token,
    sl.state,
    case
      when jsonb_typeof(sl.payload) = 'object' then sl.payload
      else '{}'::jsonb
    end as payload
  into listing_row
  from public.shared_listings sl
  where sl.share_path = p_share_path
    and sl.state <> 'Archived'
  order by sl.updated_at desc
  limit 1;

  if not found then
    return null;
  end if;

  -- Release approval must belong to the row whose payload/token is used.
  if coalesce(listing_row.state, '') <> 'Live'
     or coalesce(listing_row.payload ->> 'releaseConfirmedAt', '') = ''
     or coalesce(listing_row.payload ->> 'releaseConfirmedBy', '') = '' then
    return null;
  end if;

  -- An empty stored token is not a token to match against. Without the first
  -- clause, a Private Token listing that never got one resolves for a caller
  -- who supplies nothing.
  if listing_row.access_mode <> 'Public Link'
     and (listing_row.share_token = '' or coalesce(p_share_token, '') <> listing_row.share_token) then
    return null;
  end if;

  select
    (payload::jsonb
      - 'medicalNotes'
      - 'lastVetVisit'
      - 'ownership'
      - 'documentFacts'
      - 'alerts'
      - 'notes'
    )
    || jsonb_build_object(
      'medicalNotes', '',
      'lastVetVisit', '',
      'ownership', '[]'::jsonb,
      'documentFacts', '[]'::jsonb,
      'alerts', '[]'::jsonb,
      'notes', '[]'::jsonb
    )
  into horse_payload
  from public.horses
  where workspace_id = listing_row.workspace_id
    and horse_id = listing_row.horse_id
  limit 1;

  if horse_payload is null then
    return null;
  end if;

  select jsonb_build_object(
    'id', ownership_record_id,
    'horseId', horse_id,
    'legalOwner', '',
    'transferStatus', coalesce(nullif(transfer_status, ''), payload::jsonb ->> 'transferStatus', 'Pending Signatures'),
    'pendingDocuments', '[]'::jsonb,
    'complianceDeadline', coalesce(nullif(compliance_deadline, ''), payload::jsonb ->> 'complianceDeadline', ''),
    'confidence', coalesce((payload::jsonb ->> 'confidence')::numeric, 0),
    'auditTrail', '[]'::jsonb
  ) into ownership_payload
  from public.ownership_records
  where workspace_id = listing_row.workspace_id
    and horse_id = listing_row.horse_id
  order by updated_at desc
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', document_id,
        'title', coalesce(nullif(title, ''), payload::jsonb ->> 'title', ''),
        'type', coalesce(nullif(document_type, ''), payload::jsonb ->> 'type', 'Media Kit'),
        'horseId', horse_id,
        'uploadedBy', '',
        'uploadedAt', coalesce(payload::jsonb ->> 'uploadedAt', ''),
        'source', coalesce(nullif(source, ''), payload::jsonb ->> 'source', 'Manual Upload'),
        'state', coalesce(nullif(state, ''), payload::jsonb ->> 'state', 'Ready'),
        'confidence', confidence,
        'duplicateRisk', coalesce(nullif(duplicate_risk, ''), payload::jsonb ->> 'duplicateRisk', 'Low'),
        'extractedTextPreview', '',
        'summary', coalesce(payload::jsonb ->> 'summary', ''),
        'entities', coalesce(payload::jsonb -> 'entities', '{}'::jsonb),
        'fileName', payload::jsonb ->> 'fileName',
        'mimeType', payload::jsonb ->> 'mimeType',
        'fileSizeBytes', payload::jsonb -> 'fileSizeBytes'
      )
      order by updated_at desc
    ),
    '[]'::jsonb
  ) into document_payloads
  from public.documents
  where workspace_id = listing_row.workspace_id
    and horse_id = listing_row.horse_id
    and state = 'Ready';

  return jsonb_build_object(
    'horse', horse_payload,
    'documents', coalesce(document_payloads, '[]'::jsonb),
    'ownershipRecord', ownership_payload,
    'sharedListing',
      listing_row.payload
      || jsonb_build_object(
        'id', listing_row.listing_id,
        'horseId', listing_row.horse_id,
        'sharePath', listing_row.share_path,
        'accessMode', listing_row.access_mode,
        'shareToken', case when listing_row.access_mode = 'Private Token' then listing_row.share_token else '' end,
        'state', listing_row.state,
        -- The workspace of THIS row, set last so a payload key cannot stand in
        -- for it. /api/buyer/media signs only photos filed under it.
        'workspaceId', listing_row.workspace_id
      )
  );
end;
$function$;

commit;
