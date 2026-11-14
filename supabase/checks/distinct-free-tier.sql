-- DISPOSABLE DATABASE ONLY. Minimal fixture schema is created by the runner.
-- Run after 20261112120000_distinct_free_tier.sql. Rollback every fixture.
begin;
do $$
declare
  ws uuid := gen_random_uuid();
  paid uuid := gen_random_uuid();
  r record;
  plan text;
  state_name text;
  expected integer;
  trial_payload jsonb := jsonb_build_object('trial', jsonb_build_object(
    'plan', 'Professional', 'startedAt', now() - interval '1 day', 'endsAt', now() + interval '13 days'));
begin
  select * into r from public.xbar_commercial_limits(ws);
  assert r.horse_limit = 2 and r.document_limit = 10 and r.sale_packet_limit = 0;
  select * into r from public.xbar_subscription_limits(ws);
  assert r.seat_limit = 1 and r.shared_access_seat_limit = 0 and r.storage_limit_gb = 1;
  insert into public.workspace_subscription_profiles(workspace_id) values(ws);
  assert (select tier = 'Free' and billing_state = 'Inactive' from public.workspace_subscription_profiles where workspace_id = ws);
  insert into public.workspace_subscription_profiles(workspace_id, tier, billing_state, payload)
    values(paid, 'Starter', 'Active', trial_payload);
  foreach state_name in array array['Active','Manual Billing','Inactive','Past Due','Unknown'] loop
    foreach plan in array array['Starter','Professional','Ranch Ops','Enterprise','Free','Unknown'] loop
      update public.workspace_subscription_profiles set tier = plan, billing_state = state_name, payload = '{}' where workspace_id = paid;
      expected := case when state_name in ('Active','Manual Billing') then
        case plan when 'Starter' then 5 when 'Professional' then 30 when 'Ranch Ops' then 200 when 'Enterprise' then 2000 else 2 end else 2 end;
      select * into r from public.xbar_commercial_limits(paid);
      assert r.horse_limit = expected, 'tier/billing-state matrix mismatch';
    end loop;
  end loop;
  update public.workspace_subscription_profiles set tier = 'Starter', billing_state = 'Active', payload = trial_payload where workspace_id = paid;
  assert (select horse_limit = 5 from public.xbar_commercial_limits(paid)), 'trial overwrote paid Starter';
  update public.workspace_subscription_profiles set billing_state = 'Manual Billing' where workspace_id = paid;
  assert (select horse_limit = 5 from public.xbar_commercial_limits(paid)), 'trial overwrote manual Starter';
  update public.workspace_subscription_profiles set billing_state = 'Inactive' where workspace_id = paid;
  assert (select horse_limit = 30 from public.xbar_commercial_limits(paid)), 'active trial missing';
  update public.workspace_subscription_profiles set payload = jsonb_build_object('trial', jsonb_build_object(
    'plan','Professional','startedAt',now()-interval '14 days','endsAt',now())) where workspace_id = paid;
  assert (select horse_limit = 2 from public.xbar_commercial_limits(paid)), 'trial did not expire at exact boundary';
  update public.workspace_subscription_profiles set payload = '{"trial":{"plan":"Professional","startedAt":"bad","endsAt":"bad"}}' where workspace_id = paid;
  assert (select horse_limit = 2 from public.xbar_commercial_limits(paid)), 'malformed trial granted access';

  insert into public.horses(workspace_id, horse_id) values(ws,'h1'),(ws,'h2');
  begin
    insert into public.horses(workspace_id, horse_id) values(ws,'h3');
    raise exception 'third horse was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Horse limit reached for this workspace.' then raise; end if;
  end;
  insert into public.documents(workspace_id,document_id,state) select ws,'d'||n,'Ready' from generate_series(1,10) n;
  begin
    insert into public.documents(workspace_id, document_id,state) values(ws,'d11','Ready');
    raise exception 'eleventh document was accepted';
  exception when raise_exception then
    if sqlerrm <> 'Document limit reached for this workspace.' then raise; end if;
  end;
  update public.documents set size_bytes = 1073741824 where workspace_id = ws and document_id = 'd1';
  begin
    update public.documents set size_bytes = 1 where workspace_id = ws and document_id = 'd2';
    raise exception 'storage growth past 1 GiB accepted';
  exception when raise_exception then
    if sqlerrm <> 'Storage limit reached for this workspace.' then raise; end if;
  end;
  begin
    insert into public.sale_packets(workspace_id,packet_id) values(ws,'p1');
    raise exception 'Free packet accepted';
  exception when raise_exception then
    if sqlerrm <> 'Sale packet limit reached for this workspace.' then raise; end if;
  end;
  insert into public.workspace_memberships(workspace_id,email,user_id,role,status) values(ws,'one@example.test',gen_random_uuid(),'Admin','active');
  begin
    insert into public.workspace_memberships(workspace_id,email,user_id,role,status) values(ws,'two@example.test',gen_random_uuid(),'Staff','active');
    raise exception 'second seat accepted';
  exception when raise_exception then
    if sqlerrm <> 'Seat limit reached for this workspace.' then raise; end if;
  end;
  begin
    insert into public.workspace_invitations(workspace_id,invitation_id,email,role,status) values(ws,'i1','two@example.test','Staff','pending');
    raise exception 'second seat invitation accepted';
  exception when raise_exception then
    if sqlerrm <> 'Seat limit reached for this workspace.' then raise; end if;
  end;

  -- Establish genuinely over-cap data while paid, then downgrade without deleting.
  update public.workspace_subscription_profiles set tier='Professional',billing_state='Active' where workspace_id=ws;
  insert into public.horses(workspace_id,horse_id) values(ws,'h3');
  insert into public.documents(workspace_id,document_id,state,size_bytes) values(ws,'d11','Ready',1);
  insert into public.sale_packets(workspace_id,packet_id) values(ws,'p1');
  insert into public.workspace_memberships(workspace_id,email,user_id,role,status) values(ws,'two@example.test',gen_random_uuid(),'Staff','active');
  insert into public.shared_listings(workspace_id,listing_id,state,payload) values(ws,'l1','Live','{"releaseConfirmedAt":"2026-11-01","releaseConfirmedBy":"owner"}');
  insert into public.sales_leads(workspace_id,lead_id,payload) values(ws,'lead1','{"offerAmount":100}');
  update public.workspace_subscription_profiles set billing_state='Inactive' where workspace_id=ws;
  insert into public.shared_listings(workspace_id,listing_id,state,payload) values(ws,'l1','Live','{"releaseConfirmedAt":"2026-11-01","releaseConfirmedBy":"owner"}')
    on conflict(workspace_id,listing_id) do update set payload=excluded.payload, updated_at=now(), published_at=now();
  insert into public.sales_leads(workspace_id,lead_id,payload) values(ws,'lead1','{"offerAmount":100,"note":"preserve offer"}')
    on conflict(workspace_id,lead_id) do update set payload=excluded.payload;
  begin
    update public.sales_leads set payload='{"offerAmount":200}' where workspace_id=ws;
    raise exception 'Free offer change accepted';
  exception when raise_exception then
    if sqlerrm <> 'Buyer Deal Room offer workflows require Professional or higher.' then raise; end if;
  end;
  begin
    insert into public.shared_listings(workspace_id,listing_id,state) values(ws,'l2','Draft');
    raise exception 'new Free listing accepted';
  exception when raise_exception then
    if sqlerrm <> 'Buyer Deal Room requires Professional or higher.' then raise; end if;
  end;
  update public.shared_listings set state='Archived' where workspace_id=ws;
  begin
    update public.shared_listings set state='Live' where workspace_id=ws;
    raise exception 'Free listing reactivation accepted';
  exception when raise_exception then
    if sqlerrm <> 'Buyer Deal Room requires Professional or higher.' then raise; end if;
  end;
  update public.horses set payload='{"name":"preserved"}' where workspace_id=ws;
  insert into public.horses(workspace_id,horse_id,payload) values(ws,'h3','{"name":"upsert preserved"}')
    on conflict(workspace_id,horse_id) do update set payload=excluded.payload;
  update public.documents set payload='{"title":"preserved"}' where workspace_id=ws;
  insert into public.documents(workspace_id,document_id,state,size_bytes) values(ws,'d1','Ready',1073741824)
    on conflict(workspace_id,document_id) do update set size_bytes=excluded.size_bytes;
  update public.sale_packets set payload='{"title":"preserved"}' where workspace_id=ws;
  insert into public.sale_packets(workspace_id,packet_id) values(ws,'p1')
    on conflict(workspace_id,packet_id) do update set payload=excluded.payload;
  update public.workspace_memberships set email=email where workspace_id=ws;
  assert (select count(*)=3 from public.horses where workspace_id=ws), 'downgrade lost records';
  update public.documents set state='Archived' where workspace_id=ws and document_id='d11';
  begin
    update public.documents set state='Ready' where workspace_id=ws and document_id='d11';
    raise exception 'unarchive past cap accepted';
  exception when raise_exception then
    if sqlerrm <> 'Document limit reached for this workspace.' then raise; end if;
  end;
end $$;
rollback;
