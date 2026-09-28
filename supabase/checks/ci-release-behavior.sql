-- Synthetic local database only. Never execute against production.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,email) values
 ('71000000-0000-4000-8000-000000000001','release-owner@example.invalid'),
 ('71000000-0000-4000-8000-000000000002','release-outsider@example.invalid');
insert into public.workspaces(id,owner_user_id) values
 ('72000000-0000-4000-8000-000000000001','71000000-0000-4000-8000-000000000001');
insert into public.workspace_subscription_profiles(workspace_id,tier,billing_state,payload) values
 ('72000000-0000-4000-8000-000000000001','Starter','Inactive',
  jsonb_build_object('trial',jsonb_build_object('startedAt',now()-interval '1 day',
    'endsAt',now()+interval '13 days','plan','Professional')));

set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
-- Exercise the real insert trigger and RLS, not only the helper's return value.
insert into public.horses(workspace_id,horse_id,name,payload)
 select '72000000-0000-4000-8000-000000000001', 'release-'||i, 'Synthetic horse '||i, '{}'::jsonb
 from generate_series(1,6) i;
do $$ begin
 if (select count(*) from public.horses where workspace_id='72000000-0000-4000-8000-000000000001') <> 6
 then raise exception 'active trial did not admit sixth horse'; end if;
end $$;
reset role;
update public.workspace_subscription_profiles
 set payload=jsonb_build_object('trial',jsonb_build_object('startedAt',now()-interval '15 days',
   'endsAt',now()-interval '1 day','plan','Professional'))
 where workspace_id='72000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$ begin
 begin
  insert into public.horses(workspace_id,horse_id,name) values
   ('72000000-0000-4000-8000-000000000001','release-7','Must be refused');
  raise exception 'expired trial incorrectly admitted another horse';
 exception when raise_exception then
  if sqlerrm <> 'Horse limit reached for this workspace.' then raise; end if;
 end;
end $$;
reset role;
-- The actual service-only webhook RPC must accept the named billing argument,
-- preserve existing trial history and persist the annual period. No Stripe call.
set local role service_role;
do $$ declare applied boolean; begin
 applied := public.xbar_apply_subscription_event(
  p_workspace_id => '72000000-0000-4000-8000-000000000001',
  p_event_id => 'evt_release_synthetic', p_event_type => 'checkout.session.completed',
  p_event_created_at => now(), p_payload => '{}'::jsonb, p_tier => 'Professional',
  p_billing_state => 'Active', p_monthly_rate => 0, p_profile => '{}'::jsonb,
  p_customer_id => 'cus_synthetic', p_subscription_id => 'sub_synthetic',
  p_price_id => 'price_synthetic', p_seat_count => 1, p_billing_period => 'annual');
 if applied is distinct from true then raise exception 'event was not applied'; end if;
 if not exists(select 1 from public.workspace_subscription_profiles
  where workspace_id='72000000-0000-4000-8000-000000000001' and billing_period='annual' and payload ? 'trial')
 then raise exception 'event lost period or trial history'; end if;
end $$;
reset role;
-- RLS visibility of an uploader's synthetic object. Storage HTTP and forged
-- gallery references require separate acceptance; this does not clear those.
insert into storage.objects(bucket_id,name) values
 ('horse-media','71000000-0000-4000-8000-000000000001/horses/release/photo.jpg');
do $$ begin
 if (select public from storage.buckets where id='horse-media') is distinct from false
 then raise exception 'horse-media bucket is not private'; end if;
end $$;
set local role authenticated;
do $$ begin
 if (select count(*) from storage.objects where bucket_id='horse-media') <> 1
 then raise exception 'uploader cannot read own media'; end if;
end $$;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',true);
do $$ begin
 if exists(select 1 from storage.objects where bucket_id='horse-media')
 then raise exception 'unrelated user read media'; end if;
end $$;
reset role;
rollback;
