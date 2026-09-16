-- Require release approval on the selected listing, not another row sharing its path.
-- The public wrapper's EXISTS check alone can approve a different row than the
-- legacy resolver returns. Keep the existing token checks and function grants.
-- Transactional and idempotent; no listing rows are changed.
-- Applied to xbar-records as 20260911003739; live rollback regression passed.
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
        'state', listing_row.state
      )
  );
end;
$function$;

create or replace function public.xbar_track_public_share_view(
  p_share_path text,
  p_share_token text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  listing_row record;
begin
  select
    sl.workspace_id,
    sl.listing_id,
    sl.horse_id,
    coalesce(nullif(sl.access_mode, ''), 'Private Token') as access_mode,
    coalesce(sl.share_token, '') as share_token,
    sl.state,
    sl.payload
  into listing_row
  from public.shared_listings sl
  where sl.share_path = p_share_path
    and sl.state <> 'Archived'
  order by sl.updated_at desc
  limit 1;

  if not found then
    return;
  end if;

  -- Release approval must belong to the row whose payload/token is used.
  if coalesce(listing_row.state, '') <> 'Live'
     or coalesce(listing_row.payload ->> 'releaseConfirmedAt', '') = ''
     or coalesce(listing_row.payload ->> 'releaseConfirmedBy', '') = '' then
    return;
  end if;

  -- Same rule as the resolver: an empty stored token matches nothing.
  if listing_row.access_mode <> 'Public Link'
     and (listing_row.share_token = '' or coalesce(p_share_token, '') <> listing_row.share_token) then
    return;
  end if;

  insert into public.public_share_events (
    workspace_id,
    listing_id,
    horse_id,
    share_path,
    event_type,
    access_mode,
    metadata
  ) values (
    listing_row.workspace_id,
    listing_row.listing_id,
    listing_row.horse_id,
    p_share_path,
    'view',
    listing_row.access_mode,
    jsonb_build_object('trackedAt', timezone('utc', now()))
  );
end;
$function$;

commit;
