-- Prepared remediation only. Production application requires owner approval.
-- Replaces only the existing resolver body; signature, owner and ACL stay unchanged.
begin;

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
  gallery_payload jsonb;
begin
  select
    sl.workspace_id,
    sl.listing_id,
    sl.horse_id,
    sl.share_path,
    coalesce(nullif(sl.access_mode, ''), 'Private Token') as access_mode,
    coalesce(sl.share_token, '') as share_token,
    sl.state,
    sl.channels,
    sl.updated_at,
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

  -- Only buyer-facing scalar fields cross this boundary. Unknown fields never do.
  select jsonb_build_object(
    'id', horse_id,
    'name', case when jsonb_typeof(payload -> 'name') = 'string' then payload -> 'name' else to_jsonb(''::text) end,
    'barnName', case when jsonb_typeof(payload -> 'barnName') = 'string' then payload -> 'barnName' else to_jsonb(''::text) end,
    'breed', case when jsonb_typeof(payload -> 'breed') = 'string' then payload -> 'breed' else to_jsonb(''::text) end,
    'registry', case when jsonb_typeof(payload -> 'registry') = 'string' then payload -> 'registry' else to_jsonb(''::text) end,
    'aqhaNumber', case when jsonb_typeof(payload -> 'aqhaNumber') = 'string' then payload -> 'aqhaNumber' else to_jsonb(''::text) end,
    'registrationNumber', case when jsonb_typeof(payload -> 'registrationNumber') = 'string' then payload -> 'registrationNumber' else to_jsonb(''::text) end,
    'foaledOn', case when jsonb_typeof(payload -> 'foaledOn') = 'string' then payload -> 'foaledOn' else to_jsonb(''::text) end,
    'sex', case when jsonb_typeof(payload -> 'sex') = 'string' then payload -> 'sex' else to_jsonb(''::text) end,
    'color', case when jsonb_typeof(payload -> 'color') = 'string' then payload -> 'color' else to_jsonb(''::text) end,
    'markings', case when jsonb_typeof(payload -> 'markings') = 'string' then payload -> 'markings' else to_jsonb(''::text) end,
    'registered', case when jsonb_typeof(payload -> 'registered') = 'boolean' then payload -> 'registered' else to_jsonb(false) end,
    'age', case when jsonb_typeof(payload -> 'age') = 'number' then payload -> 'age' else to_jsonb(0) end,
    'bloodline', coalesce((select jsonb_object_agg(key, value) from jsonb_each(case when jsonb_typeof(payload -> 'bloodline') = 'object' then payload -> 'bloodline' else '{}'::jsonb end) where key in ('sire', 'dam', 'family') and jsonb_typeof(value) = 'string'), '{}'::jsonb),
    'sale', jsonb_build_object('listingState', case when jsonb_typeof(payload #> '{sale,listingState}') = 'string' then payload #> '{sale,listingState}' else to_jsonb('Private'::text) end, 'askPrice', case when jsonb_typeof(payload #> '{sale,askPrice}') = 'number' then payload #> '{sale,askPrice}' else to_jsonb(0) end, 'socialReady', case when jsonb_typeof(payload #> '{sale,socialReady}') = 'boolean' then payload #> '{sale,socialReady}' else to_jsonb(false) end, 'buyerConfidence', 0, 'inquiryCount', 0, 'watchlistCount', 0),
    'readiness', jsonb_build_object('score', case when jsonb_typeof(payload #> '{readiness,score}') = 'number' then payload #> '{readiness,score}' else to_jsonb(0) end, 'packetStatus', case when jsonb_typeof(payload #> '{readiness,packetStatus}') = 'string' then payload #> '{readiness,packetStatus}' else to_jsonb(''::text) end, 'blockers', '[]'::jsonb)
  ) into horse_payload
  from public.horses
  where workspace_id = listing_row.workspace_id
    and horse_id = listing_row.horse_id
  limit 1;

  if horse_payload is null then
    return null;
  end if;

  -- Approval and real-photo kind are both required, including storage-only photos.
  select coalesce(jsonb_agg(
    coalesce((select jsonb_object_agg(key, value) from jsonb_each(case when jsonb_typeof(asset) = 'object' then asset else '{}'::jsonb end) where key in ('id', 'label', 'kind', 'url', 'storagePath', 'status') and jsonb_typeof(value) = 'string'), '{}'::jsonb)
    || jsonb_build_object('isPrimary', case when jsonb_typeof(asset -> 'isPrimary') = 'boolean' then asset -> 'isPrimary' else to_jsonb(false) end), '[]'::jsonb)
  into gallery_payload
  from public.horses h
  cross join lateral jsonb_array_elements(case when jsonb_typeof(h.payload -> 'gallery') = 'array'
    then h.payload -> 'gallery' else '[]'::jsonb end) asset
  where h.workspace_id = listing_row.workspace_id and h.horse_id = listing_row.horse_id
    and asset ->> 'status' = 'Approved'
    and asset ->> 'kind' in ('Hero', 'Conformation', 'Sale Still');

  horse_payload := horse_payload || jsonb_build_object('gallery', gallery_payload, 'profileImage',
    coalesce((select asset ->> 'url' from jsonb_array_elements(gallery_payload) with ordinality photo(asset, position)
      order by (asset ->> 'isPrimary' = 'true') desc, position limit 1), ''));

  select jsonb_build_object(
    'id', ownership_record_id, 'horseId', horse_id,
    'transferStatus', coalesce(nullif(transfer_status, ''), 'Pending Signatures'),
    'confidence', case when jsonb_typeof(payload -> 'confidence') = 'number' then payload -> 'confidence' else to_jsonb(0) end
  ) into ownership_payload
  from public.ownership_records
  where workspace_id = listing_row.workspace_id and horse_id = listing_row.horse_id
  order by updated_at desc limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', document_id,
        'title', coalesce(nullif(title, ''), case when jsonb_typeof(payload -> 'title') = 'string' then payload ->> 'title' else '' end, ''),
        'type', coalesce(nullif(document_type, ''), case when jsonb_typeof(payload -> 'type') = 'string' then payload ->> 'type' else '' end, 'Media Kit'),
        'horseId', horse_id,
        'uploadedBy', '',
        'uploadedAt', coalesce(case when jsonb_typeof(payload -> 'uploadedAt') = 'string' then payload ->> 'uploadedAt' else '' end, ''),
        'source', coalesce(nullif(source, ''), case when jsonb_typeof(payload -> 'source') = 'string' then payload ->> 'source' else '' end, 'Manual Upload'),
        'state', coalesce(nullif(state, ''), case when jsonb_typeof(payload -> 'state') = 'string' then payload ->> 'state' else '' end, 'Ready'),
        'confidence', confidence,
        'duplicateRisk', coalesce(nullif(duplicate_risk, ''), case when jsonb_typeof(payload -> 'duplicateRisk') = 'string' then payload ->> 'duplicateRisk' else '' end, 'Low'),
        'extractedTextPreview', '',
        'summary', coalesce(case when jsonb_typeof(payload -> 'summary') = 'string' then payload ->> 'summary' else '' end, ''),
        'entities', coalesce((select jsonb_object_agg(key, value) from jsonb_each(case when jsonb_typeof(payload -> 'entities') = 'object' then payload -> 'entities' else '{}'::jsonb end) where key in ('horseName', 'registrationNumber', 'registry', 'sex', 'color', 'breed', 'foaledOn', 'sire', 'sireRegistration', 'dam', 'damRegistration', 'ownerName', 'examDate', 'veterinarian', 'transferStatus') and jsonb_typeof(value) = 'string'), '{}'::jsonb),
        'fileName', case when jsonb_typeof(payload -> 'fileName') = 'string' then payload ->> 'fileName' else '' end,
        'mimeType', case when jsonb_typeof(payload -> 'mimeType') = 'string' then payload ->> 'mimeType' else '' end,
        'fileSizeBytes', case when jsonb_typeof(payload -> 'fileSizeBytes') = 'number' then payload -> 'fileSizeBytes' else to_jsonb(0) end
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
      jsonb_build_object(
        'id', listing_row.listing_id,
        'horseId', listing_row.horse_id,
        'sharePath', listing_row.share_path,
        'accessMode', listing_row.access_mode,
        'shareToken', case when listing_row.access_mode = 'Private Token' then listing_row.share_token else '' end,
        'state', listing_row.state,
        'channels', to_jsonb(array(select channel from unnest(listing_row.channels) channel where channel in ('Direct Link', 'Facebook'))),
        'updatedAt', listing_row.updated_at,
        -- The workspace of THIS row, set last so a payload key cannot stand in
        -- for it. /api/buyer/media signs only photos filed under it.
        'workspaceId', listing_row.workspace_id
      )
  );
end;
$function$;

commit;
