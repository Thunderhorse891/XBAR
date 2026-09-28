-- Isolated synthetic database only. Never run fixture writes in production.
\set ON_ERROR_STOP on
begin;
do $$ begin
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p')
  and (has_table_privilege('anon',c.oid,'SELECT') or has_any_column_privilege('anon',c.oid,'SELECT')))
 then raise exception 'anonymous table discovery remains enabled'; end if;
end $$;
insert into auth.users(id,email) values
 ('81000000-0000-4000-8000-000000000001','share-owner@example.invalid');
insert into public.workspaces(id,owner_user_id) values
 ('82000000-0000-4000-8000-000000000001','81000000-0000-4000-8000-000000000001');
insert into public.workspace_subscription_profiles(workspace_id,tier,billing_state) values
 ('82000000-0000-4000-8000-000000000001','Professional','Active');
insert into public.horses(workspace_id,horse_id,name,payload) values
 ('82000000-0000-4000-8000-000000000001','share-horse','Synthetic horse','{"name":"Synthetic horse"}');
insert into public.shared_listings(workspace_id,listing_id,horse_id,share_path,state,access_mode,share_token,payload) values
 ('82000000-0000-4000-8000-000000000001','share-listing','share-horse','/verify/anon-table-test','Live','Private Token','synthetic-token',
 '{"releaseConfirmedAt":"2026-09-28T00:00:00Z","releaseConfirmedBy":"Synthetic test"}'),
 ('82000000-0000-4000-8000-000000000001','public-listing','share-horse','/verify/anon-public-test','Live','Public Link','',
 '{"releaseConfirmedAt":"2026-09-28T00:00:00Z","releaseConfirmedBy":"Synthetic test"}');
set local role anon;
do $$ begin
 begin
  perform * from public.horses;
  raise exception 'anon table read did not raise permission denial';
 exception when insufficient_privilege then null; end;
 if public.xbar_resolve_public_listing('/verify/anon-table-test',null) is not null
 then raise exception 'missing token resolved'; end if;
 if public.xbar_resolve_public_listing('/verify/anon-table-test','wrong') is not null
 then raise exception 'wrong token resolved'; end if;
 if public.xbar_resolve_public_listing('/verify/anon-table-test','synthetic-token') is null
 then raise exception 'intended public resolver stopped working'; end if;
 if public.xbar_resolve_public_listing('/verify/anon-public-test',null) is null
 then raise exception 'intended tokenless Public Link stopped working'; end if;
 perform public.xbar_track_public_share_view('/verify/anon-table-test','wrong');
 perform public.xbar_track_public_share_view('/verify/anon-table-test','synthetic-token');
 perform public.xbar_track_public_share_view('/verify/anon-public-test',null);
end $$;
reset role;
do $$ begin
 if (select count(*) from public.public_share_events where workspace_id='82000000-0000-4000-8000-000000000001' and share_path='/verify/anon-table-test') <> 1
 then raise exception 'public tracker failed token authorization or insertion'; end if;
 if (select count(*) from public.public_share_events where workspace_id='82000000-0000-4000-8000-000000000001' and share_path='/verify/anon-public-test') <> 1
 then raise exception 'tokenless Public Link view was not recorded'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub','81000000-0000-4000-8000-000000000001',true);
do $$ begin
 if (select count(*) from public.horses where horse_id='share-horse') <> 1
 then raise exception 'authenticated owner lost row access'; end if;
end $$;
reset role;
rollback;
