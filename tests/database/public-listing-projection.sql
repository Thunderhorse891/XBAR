-- Run only in the isolated fixture. Every test record rolls back.
begin;
select set_config('xbar.fixture_fixed', :'expect_fixed', true);
insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000051','listing-fixture@example.invalid');
insert into public.workspaces(id,owner_user_id,name) values ('10000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000051','Synthetic listing ranch');
insert into public.workspace_subscription_profiles(workspace_id,tier,billing_state) values ('10000000-0000-4000-8000-000000000051','Enterprise','Manual Billing');
insert into public.horses(workspace_id,horse_id,name,payload) values (
 '10000000-0000-4000-8000-000000000051','horse-projection','Synthetic horse',
 '{"id":"horse-projection","name":"Synthetic horse","registered":true,"age":7,"breed":"Quarter Horse","registry":"AQHA","registrationNumber":"12345","sex":"Mare","costBasis":987654,"insuredValue":123456,"owner":"PRIVATE_SENTINEL","location":{"barn":"PRIVATE_SENTINEL"},"medicalTimeline":["PRIVATE_SENTINEL"],"newPrivateField":"PRIVATE_SENTINEL","profileImage":"PRIVATE_SENTINEL","bloodline":{"sire":"Public sire","dam":"Public dam","family":"Public family","private":"PRIVATE_SENTINEL"},"sale":{"listingState":"Market Ready","askPrice":15000,"socialReady":true,"buyerConfidence":91,"inquiryCount":8,"private":"PRIVATE_SENTINEL"},"readiness":{"score":80,"packetStatus":"Ready","blockers":["PRIVATE_SENTINEL"],"private":"PRIVATE_SENTINEL"},"gallery":[{"id":"public-photo","kind":"Hero","status":"Approved","label":"Public photo","url":"https://example.invalid/public.jpg","storagePath":"10000000-0000-4000-8000-000000000051/horses/horse-projection/media-public.jpg","isPrimary":true,"private":"PRIVATE_SENTINEL"},{"id":"private-photo","kind":"Hero","status":"Pending","url":"PRIVATE_SENTINEL"},{"id":"private-scan","kind":"Document Cover","status":"Approved","url":"PRIVATE_SENTINEL"}]}'
);
insert into public.documents(workspace_id,document_id,horse_id,title,document_type,state,payload) values (
 '10000000-0000-4000-8000-000000000051','doc-projection','horse-projection','Public certificate','Registration','Ready',
 '{"summary":"Public certificate summary","fileName":"certificate.pdf","mimeType":"application/pdf","fileSizeBytes":42,"fileUrl":"PRIVATE_SENTINEL","storagePath":"PRIVATE_SENTINEL","entities":{"registrationNumber":"12345","sire":"Public sire","private":"PRIVATE_SENTINEL"}}'
);
insert into public.ownership_records(workspace_id,ownership_record_id,horse_id,payload) values ('10000000-0000-4000-8000-000000000051','ownership-projection','horse-projection','{"transferStatus":"Complete","confidence":95,"legalOwner":"PRIVATE_SENTINEL","auditTrail":["PRIVATE_SENTINEL"]}');
insert into public.shared_listings(workspace_id,listing_id,horse_id,share_path,state,access_mode,share_token,channels,payload) values (
 '10000000-0000-4000-8000-000000000051','listing-projection','horse-projection','synthetic-projection','Live','Private Token','synthetic-token',array['Direct Link'],
 '{"releaseConfirmedAt":"2026-10-05","releaseConfirmedBy":"PRIVATE_SENTINEL","workspaceId":"PRIVATE_SENTINEL","internalNote":"PRIVATE_SENTINEL"}'
);

do $$
declare result jsonb; broken_first text; fixed boolean := current_setting('xbar.fixture_fixed')='1';
begin
 set local role anon;
 result := public.xbar_resolve_public_listing('synthetic-projection','synthetic-token');
 if current_setting('xbar.fixture_fixed')='closed' then
  if result is not null then raise exception 'Emergency fallback exposed a listing'; end if;
  reset role;
  raise notice 'CLOSED: emergency fallback denies an otherwise valid synthetic buyer link';
  return;
 end if;
 if result is null or result #>> '{horse,name}' <> 'Synthetic horse' then raise exception 'Valid buyer link did not resolve'; end if;
 if result #>> '{ownershipRecord,transferStatus}' <> 'Complete' or result #>> '{ownershipRecord,confidence}' <> '95' then raise exception 'Legacy ownership summary regressed'; end if;
 if result #>> '{sharedListing,workspaceId}' <> '10000000-0000-4000-8000-000000000051' then raise exception 'Canonical workspace lost'; end if;
 if public.xbar_resolve_public_listing('synthetic-projection',null) is not null or public.xbar_resolve_public_listing('synthetic-projection','wrong') is not null then raise exception 'Private token gate bypass'; end if;
 if fixed then
  if result::text like '%PRIVATE_SENTINEL%' or result->'horse' ?| array['costBasis','insuredValue','owner','location','medicalTimeline','newPrivateField'] then raise exception 'Private data crossed raw RPC boundary'; end if;
  if result #>> '{horse,sale,askPrice}' <> '15000' or result #>> '{horse,bloodline,sire}' <> 'Public sire' or result #>> '{documents,0,entities,registrationNumber}' <> '12345' then raise exception 'Buyer fields regressed'; end if;
  if jsonb_array_length(result #> '{horse,gallery}') <> 1 or result #>> '{horse,gallery,0,storagePath}' not like '%/media-public.jpg' then raise exception 'Approved media contract regressed'; end if;
  if result #>> '{horse,profileImage}' <> 'https://example.invalid/public.jpg' then raise exception 'Primary photo projection regressed'; end if;
  raise notice 'FIXED: raw anonymous resolver excludes private data and retains buyer fields';
 else
  if result #>> '{horse,costBasis}' <> '987654' or result::text not like '%PRIVATE_SENTINEL%' then raise exception 'Expected historical exposure did not reproduce'; end if;
  raise notice 'BASELINE: raw anonymous resolver exposes cost basis and private sentinel';
 end if;
 reset role;
 update public.shared_listings set access_mode='Public Link' where listing_id='listing-projection';
 if public.xbar_resolve_public_listing('synthetic-projection',null) is null then raise exception 'Public link requires token'; end if;
 update public.shared_listings set state='Draft', payload=payload-'releaseConfirmedAt' where listing_id='listing-projection';
 if public.xbar_resolve_public_listing('synthetic-projection',null) is not null then raise exception 'Missing release accepted'; end if;
 update public.shared_listings set payload=payload||'{"releaseConfirmedAt":"2026-10-05"}', state='Archived' where listing_id='listing-projection';
 if public.xbar_resolve_public_listing('synthetic-projection',null) is not null then raise exception 'Archived listing accepted'; end if;
 update public.shared_listings set state='Live', updated_at='2026-10-04' where listing_id='listing-projection';
 insert into public.shared_listings(workspace_id,listing_id,horse_id,share_path,state,access_mode,payload,updated_at)
 select workspace_id,'newer-draft',horse_id,share_path,'Draft','Public Link','{}','2026-10-05' from public.shared_listings where listing_id='listing-projection';
 if public.xbar_resolve_public_listing('synthetic-projection',null) is not null then raise exception 'Older release authorized newer draft'; end if;
 delete from public.shared_listings where listing_id='newer-draft';
 if fixed then
  update public.horses set payload=payload||'{"name":{"secret":"PRIVATE_SENTINEL"},"bloodline":["PRIVATE_SENTINEL"],"gallery":{"private":"PRIVATE_SENTINEL"},"sale":{"askPrice":{"secret":"PRIVATE_SENTINEL"}},"readiness":null}' where horse_id='horse-projection';
  update public.documents set payload=payload||'{"summary":{"secret":"PRIVATE_SENTINEL"},"entities":{"sire":{"secret":"PRIVATE_SENTINEL"}},"fileSizeBytes":{"secret":"PRIVATE_SENTINEL"}}' where document_id='doc-projection';
  result := public.xbar_resolve_public_listing('synthetic-projection',null);
  if result is null or result::text like '%PRIVATE_SENTINEL%' or result #> '{horse,gallery}' <> '[]'::jsonb then raise exception 'Malformed containers crossed boundary or broke resolution'; end if;
  update public.horses set payload=jsonb_set(payload,'{gallery}','[{"id":"storage-only","kind":"Conformation","status":"Approved","storagePath":"10000000-0000-4000-8000-000000000051/horses/horse-projection/media-only.jpg"}]') where horse_id='horse-projection';
  result := public.xbar_resolve_public_listing('synthetic-projection',null);
  if result #>> '{horse,gallery,0,storagePath}' not like '%/media-only.jpg' then raise exception 'Storage-only photo lost'; end if;
  update public.horses set payload=jsonb_set(payload,'{gallery}','[{"id":"older","kind":"Hero","status":"Approved","url":"https://example.invalid/older.jpg"},{"id":"selected","kind":"Conformation","status":"Approved","storagePath":"10000000-0000-4000-8000-000000000051/horses/horse-projection/media-selected.jpg","isPrimary":true}]') where horse_id='horse-projection';
  result := public.xbar_resolve_public_listing('synthetic-projection',null);
  if result #>> '{horse,gallery,0,id}' <> 'selected' or result #>> '{horse,profileImage}' <> '' then raise exception 'Selected storage-only primary is hidden behind older URL photo'; end if;
  update public.horses set payload=payload||'{"profileImage":"https://example.invalid/selected.jpg","gallery":[{"id":"older","kind":"Hero","status":"Approved","url":"https://example.invalid/older.jpg"},{"id":"selected","kind":"Conformation","status":"Approved","url":"https://example.invalid/selected.jpg"}]}' where horse_id='horse-projection';
  result := public.xbar_resolve_public_listing('synthetic-projection',null);
  if result #>> '{horse,gallery,0,id}' <> 'selected' or result #>> '{horse,profileImage}' <> 'https://example.invalid/selected.jpg' then raise exception 'Legacy URL-based primary selection regressed'; end if;
  -- Reproduce the pre-correction false-vs-absent ordering under real PostgreSQL.
  select asset ->> 'id' into broken_first
  from jsonb_array_elements('[{"id":"older","isPrimary":false},{"id":"selected"}]'::jsonb) with ordinality photo(asset, position)
  order by (asset -> 'isPrimary' = 'true'::jsonb) desc nulls last, position limit 1;
  if broken_first <> 'older' then raise exception 'Expected false-vs-absent ranking trigger changed'; end if;
  update public.horses set payload=payload||'{"profileImage":"https://example.invalid/selected.jpg","gallery":[{"id":"older","kind":"Hero","status":"Approved","url":"https://example.invalid/older.jpg","isPrimary":false},{"id":"selected","kind":"Hero","status":"Approved","url":"https://example.invalid/selected.jpg"}]}' where horse_id='horse-projection';
  result := public.xbar_resolve_public_listing('synthetic-projection',null);
  if result #>> '{horse,gallery,0,id}' <> 'selected' then raise exception 'Explicit false incorrectly outranks missing primary flag'; end if;
  -- Without a selection, preserve source order across absent, null and empty URLs.
  update public.horses set payload=payload||'{"profileImage":null,"gallery":[{"id":"first-storage","kind":"Hero","status":"Approved","storagePath":"10000000-0000-4000-8000-000000000051/horses/horse-projection/media-first.jpg"},{"id":"null-url","kind":"Hero","status":"Approved","url":null,"isPrimary":false},{"id":"older-url","kind":"Hero","status":"Approved","url":"https://example.invalid/older.jpg"}]}' where horse_id='horse-projection';
  result := public.xbar_resolve_public_listing('synthetic-projection',null);
  if result #>> '{horse,gallery,0,id}' <> 'first-storage' then raise exception 'Null metadata reordered an unselected gallery'; end if;
  update public.horses set payload=jsonb_set(payload,'{profileImage}','""') where horse_id='horse-projection';
  result := public.xbar_resolve_public_listing('synthetic-projection',null);
  if result #>> '{horse,gallery,0,id}' <> 'first-storage' then raise exception 'Empty profile selection reordered gallery'; end if;


 end if;
end;
$$;
rollback;
