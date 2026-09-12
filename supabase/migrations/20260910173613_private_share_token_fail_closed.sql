-- Refuse a Private Token listing whose stored token is empty.
--
-- Applied to xbar-records (uxvwfepyothlakhqazwv) on 2026-09-10,
-- ledger version 20260910173613. Both guards and validated CHECK verified.
--
-- The FILENAME carries that same version deliberately. Supabase takes the
-- digits before the first underscore as the migration version, so a file named
-- for a different day is a migration the live ledger has no entry for: history
-- comparisons disagree, and a later CLI rollout offers this security migration
-- as still pending. Re-applying it is harmless -- both functions are `create or
-- replace` and the constraint is dropped if it exists first -- but "pending"
-- against a project that already has it is a false reading of a security fix.
-- Other projects: see "How to apply this" at the bottom.
--
-- WHY
-- ---
-- `xbar_resolve_public_listing` and `xbar_track_public_share_view` are the two
-- functions `anon` may execute, because a buyer opens a share link with no
-- account. Both gate a non-public listing on the caller's token:
--
--     if listing_row.access_mode <> 'Public Link'
--        and coalesce(p_share_token, '') <> listing_row.share_token then
--       return null;
--     end if;
--
-- `listing_row.share_token` is itself `coalesce(sl.share_token, '')`, so for a
-- Private Token row whose stored token is empty the comparison is '' <> '',
-- which is false -- the guard does not fire, and a caller who knows only the
-- share_path receives the horse payload, its documents and its ownership
-- record. The check is written to reject a WRONG token and reads as though it
-- also rejects a MISSING one; it does not.
--
-- Read from the live project on 9 Sep 2026, the shape that triggers it is the
-- column default rather than a mistake:
--
--     access_mode  text not null default 'Private Token'
--     share_token  text not null default ''
--
--     select conname, pg_get_constraintdef(oid) from pg_constraint
--     where conrelid = 'public.shared_listings'::regclass;
--     -- only shared_listings_pkey and shared_listings_workspace_id_fkey
--
-- So nothing stops an insert that omits share_token from landing as a private
-- listing anyone can open. No such row exists today (shared_listings is empty
-- on that project), which is why this is a latent fail-open rather than a live
-- exposure -- and why it is worth closing before the table has rows in it.
--
-- WHAT THIS CHANGES
-- -----------------
-- 1. Both functions treat an empty stored token as "no valid token exists" and
--    refuse, instead of accepting an empty caller token as a match. Public Link
--    listings are untouched: they are tokenless by design and keep resolving
--    without one.
-- 2. A CHECK constraint stops the row being created at all, so the functions
--    are not the only thing standing between a defaulted insert and a public
--    private listing. Added NOT VALID and validated only if no old row violates
--    it, so existing invalid rows do not roll back the function fixes.
--
-- Defence in depth on purpose: either half alone closes today's hole, and the
-- constraint is the half that survives someone rewriting the functions.

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
    coalesce(sl.share_token, '') as share_token
  into listing_row
  from public.shared_listings sl
  where sl.share_path = p_share_path
    and sl.state <> 'Archived'
  order by sl.updated_at desc
  limit 1;

  if not found then
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

-- And stop the row existing in the first place.
--
-- NOT VALID is doing real work here, not hedging: it constrains every INSERT
-- and UPDATE from now on while leaving rows that already exist alone. Those
-- are covered by the function change above, which refuses them.
--
-- Validation is then attempted, but only when nothing violates it. Running
-- `validate constraint` unconditionally aborts the whole migration if even one
-- private listing already has an empty token -- confirmed on PostgreSQL 16:
--
--     ERROR: check constraint "shared_listings_private_token_present"
--            of relation "shared_listings" is violated by some row
--
-- The alternative would be inventing tokens for existing listings, which is
-- silently editing customer data to make a migration pass. So the offending
-- rows are named instead and left for a person to decide about; they are not
-- resolvable by anyone without a new share link anyway.
--
-- Archived rows are exempt, and that is the difference between an operator
-- being able to clean up and not. Without the exemption, `update ... set state
-- = 'Archived'` on a broken listing is itself refused -- NOT VALID stops the
-- historical scan, it does not stop the row being re-checked when it is
-- updated -- so the only way to retire a bad share would be to first issue it
-- a working token, making it MORE usable on the way to deleting it. Confirmed
-- on PostgreSQL 16.13:
--
--     archive without a token   -> BLOCKED by the constraint
--     set a token first         -> accepted
--
-- Exempting them costs nothing, because both functions already select
-- `where sl.state <> 'Archived'`: an archived listing is unresolvable whatever
-- its token. Verified rather than assumed -- an archived, tokenless private
-- listing returns null from the resolver.
alter table public.shared_listings
  drop constraint if exists shared_listings_private_token_present;

alter table public.shared_listings
  add constraint shared_listings_private_token_present
  check (
    coalesce(state, '') = 'Archived'
    or coalesce(nullif(access_mode, ''), 'Private Token') = 'Public Link'
    or coalesce(share_token, '') <> ''
  ) not valid;

do $$
declare
  offending bigint;
begin
  select count(*) into offending
  from public.shared_listings
  where coalesce(state, '') <> 'Archived'
    and coalesce(nullif(access_mode, ''), 'Private Token') <> 'Public Link'
    and coalesce(share_token, '') = '';

  if offending = 0 then
    alter table public.shared_listings
      validate constraint shared_listings_private_token_present;
    raise notice 'shared_listings_private_token_present: validated, no offending rows';
  else
    raise warning 'shared_listings_private_token_present: left NOT VALID; % private listing(s) have an empty share_token and are refused by the resolver. Re-issue their private links with owner authorization, or archive them, then run: alter table public.shared_listings validate constraint shared_listings_private_token_present;', offending;
  end if;
end
$$;

commit;

-- HOW TO APPLY THIS
-- -----------------
-- Supabase dashboard -> SQL Editor -> paste and run, or `supabase db push`
-- with the CLI linked to the project. It is transactional and idempotent:
-- `create or replace` on both functions and a dropped-then-added constraint.
--
-- Verify afterwards, in the same editor:
--
--     select conname, pg_get_constraintdef(oid), convalidated
--     from pg_constraint
--     where conrelid = 'public.shared_listings'::regclass
--       and conname = 'shared_listings_private_token_present';
--
--     select proname, pg_get_functiondef(oid) like '%share_token = ''''%' as fails_closed
--     from pg_proc
--     where proname in ('xbar_resolve_public_listing_legacy', 'xbar_track_public_share_view');
--
-- `xbar_resolve_public_listing` is unchanged: it applies the Live/release
-- checks and then delegates to the legacy resolver patched above, so the fix
-- reaches the anon entry point through it.
