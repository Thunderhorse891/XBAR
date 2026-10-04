-- Synthetic users/workspaces only. Requires the draft upgrade-offers migration.
-- Run only on an approved disposable database. All fixtures roll back.
begin;
do $check$
declare
  owner_id uuid := gen_random_uuid();
  stranger_id uuid := gen_random_uuid();
  ws_id uuid := gen_random_uuid();
  ws_other uuid := gen_random_uuid();
  first_id uuid := gen_random_uuid();
  second_id uuid := gen_random_uuid();
  third_id uuid := gen_random_uuid();
  other_first uuid := gen_random_uuid();
  other_second uuid := gen_random_uuid();
  late_first uuid := gen_random_uuid();
  late_second uuid := gen_random_uuid();
  result jsonb;
  first_started text;
  rpc_signature text := 'public.xbar_upgrade_offer_action(uuid,uuid,text,uuid,text,text,text,text,text,integer,text,text)';
begin
  if has_function_privilege('anon', rpc_signature, 'EXECUTE') or
      has_function_privilege('authenticated', rpc_signature, 'EXECUTE') or
      not has_function_privilege('service_role', rpc_signature, 'EXECUTE') then
    raise exception 'Offer RPC grants are unsafe or incomplete.';
  end if;
  if has_table_privilege('authenticated', 'public.account_upgrade_offer_attempts', 'INSERT') or
      has_table_privilege('anon', 'public.account_upgrade_discount_claims', 'SELECT') then
    raise exception 'Offer tables are exposed to clients.';
  end if;
  insert into auth.users(id, email) values
    (owner_id, owner_id::text || '@example.invalid'), (stranger_id, stranger_id::text || '@example.invalid');
  insert into public.workspaces(id, owner_user_id, workspace_key) values
    (ws_id, owner_id, ws_id::text), (ws_other, owner_id, ws_other::text);

  result := public.xbar_upgrade_offer_action(stranger_id, ws_id, 'buyerDealRoom', first_id, 'monthly', 'attempt');
  if result->>'code' <> 'owner_required' then raise exception 'Non-owner was not refused: %', result; end if;
  if exists(select 1 from public.account_upgrade_offer_attempts where attempt_id = first_id) then
    raise exception 'Unauthorized request wrote an attempt.';
  end if;
  result := public.xbar_upgrade_offer_action(owner_id, ws_id, 'buyerDealRoom', first_id, 'monthly', 'attempt');
  if (result->>'ok')::boolean is not true or (result->>'discountEligible')::boolean is not false or
      (result->'attempt'->>'attempt_number')::integer <> 1 then raise exception 'Wrong first offer: %', result; end if;
  result := public.xbar_upgrade_offer_action(owner_id, ws_id, 'buyerDealRoom', first_id, 'monthly', 'attempt');
  if (result->'attempt'->>'attempt_number')::integer <> 1 then raise exception 'Retry advanced count: %', result; end if;
  result := public.xbar_upgrade_offer_action(owner_id, ws_id, 'buyerDealRoom', first_id, 'monthly', 'begin_checkout',
    'checkout', 'price_pro', 'coupon_once', 10);
  if result->>'code' <> 'offer_changed' then raise exception 'First attempt forged discount: %', result; end if;
  result := public.xbar_upgrade_offer_action(owner_id, ws_id, 'buyerDealRoom', first_id, 'monthly', 'decline');
  result := public.xbar_upgrade_offer_action(owner_id, ws_id, 'buyerDealRoom', first_id, 'monthly', 'decline');

  -- Scope persists across workspaces owned by the same account.
  result := public.xbar_upgrade_offer_action(owner_id, ws_other, 'buyerDealRoom', second_id, 'annual', 'attempt');
  if (result->>'discountEligible')::boolean is not true or
      (result->'attempt'->>'attempt_number')::integer <> 2 then raise exception 'Second offer missing: %', result; end if;
  result := public.xbar_upgrade_offer_action(owner_id, ws_id, 'buyerDealRoom', third_id, 'monthly', 'attempt');
  if (result->>'discountEligible')::boolean is not false then raise exception 'Third attempt discounted: %', result; end if;
  result := public.xbar_upgrade_offer_action(owner_id, ws_id, 'buyerDealRoom', second_id, 'annual', 'read');
  if result->>'code' <> 'attempt_conflict' then raise exception 'Cross-workspace replay accepted: %', result; end if;
  result := public.xbar_upgrade_offer_action(owner_id, ws_other, 'packetExport', second_id, 'annual', 'read');
  if result->>'code' <> 'attempt_conflict' then raise exception 'Cross-feature replay accepted: %', result; end if;
  result := public.xbar_upgrade_offer_action(owner_id, ws_other, 'buyerDealRoom', second_id, 'monthly', 'read');
  if result->>'code' <> 'attempt_conflict' then raise exception 'Cadence replay accepted: %', result; end if;

  result := public.xbar_upgrade_offer_action(owner_id, ws_other, 'buyerDealRoom', second_id, 'annual', 'begin_checkout',
    'checkout', 'price_pro_annual', 'coupon_once', 10);
  if (result->>'ok')::boolean is not true then raise exception 'Eligible checkout refused: %', result; end if;
  first_started := result->'attempt'->>'checkout_started_at';
  result := public.xbar_upgrade_offer_action(owner_id, ws_other, 'buyerDealRoom', second_id, 'annual', 'begin_checkout',
    'checkout', 'price_pro_annual', 'coupon_once', 10);
  if result->'attempt'->>'checkout_started_at' <> first_started then raise exception 'Retry changed checkout identity.'; end if;
  if (select count(*) from public.account_upgrade_discount_claims where user_id = owner_id) <> 1 then
    raise exception 'Discount claimed more than once.';
  end if;
  result := public.xbar_upgrade_offer_action(owner_id, ws_other, 'buyerDealRoom', second_id, 'annual', 'begin_checkout',
    'checkout', 'price_pro_annual', null, 0);
  if result->>'code' <> 'offer_changed' then raise exception 'Immutable discounted terms changed: %', result; end if;
  result := public.xbar_upgrade_offer_action(owner_id, ws_other, 'buyerDealRoom', second_id, 'annual', 'save_session',
    p_session_id => 'cs_offer', p_session_url => 'https://evil.example/payment');
  if result->>'code' <> 'session_unverified' then raise exception 'Unsafe session URL recorded: %', result; end if;
  result := public.xbar_upgrade_offer_action(owner_id, ws_other, 'buyerDealRoom', second_id, 'annual', 'save_session',
    p_session_id => 'cs_offer', p_session_url => 'https://checkout.stripe.com/c/pay/offer');
  if (result->>'ok')::boolean is not true then raise exception 'Session not recorded: %', result; end if;
  result := public.xbar_upgrade_offer_action(owner_id, ws_other, 'buyerDealRoom', second_id, 'annual', 'save_session',
    p_session_id => 'cs_other', p_session_url => 'https://checkout.stripe.com/c/pay/other');
  if result->>'code' <> 'session_conflict' then raise exception 'Session identity replaced: %', result; end if;

  result := public.xbar_upgrade_offer_action(owner_id, ws_id, 'packetExport', other_first, 'monthly', 'attempt');
  result := public.xbar_upgrade_offer_action(owner_id, ws_id, 'packetExport', other_first, 'monthly', 'decline');
  result := public.xbar_upgrade_offer_action(owner_id, ws_id, 'packetExport', other_second, 'monthly', 'attempt');
  if (result->>'discountEligible')::boolean is not false then raise exception 'Second feature evaded account claim: %', result; end if;
  result := public.xbar_upgrade_offer_action(owner_id, ws_id, 'packetExport', other_second, 'monthly', 'begin_checkout',
    'checkout', 'price_pro', 'coupon_once', 10);
  if result->>'code' <> 'offer_changed' then raise exception 'Second feature redeemed discount: %', result; end if;

  result := public.xbar_upgrade_offer_action(owner_id, ws_id, 'reportPresentation', late_first, 'monthly', 'attempt');
  result := public.xbar_upgrade_offer_action(owner_id, ws_id, 'reportPresentation', late_second, 'monthly', 'attempt');
  result := public.xbar_upgrade_offer_action(owner_id, ws_id, 'reportPresentation', late_first, 'monthly', 'decline');
  result := public.xbar_upgrade_offer_action(owner_id, ws_id, 'reportPresentation', late_second, 'monthly', 'read');
  if (result->'attempt'->>'discount_eligible')::boolean is not false then raise exception 'Late decline retroactively granted discount.'; end if;
  update public.account_upgrade_offer_attempts set created_at = now() - interval '31 minutes' where attempt_id = late_second;
  result := public.xbar_upgrade_offer_action(owner_id, ws_id, 'reportPresentation', late_second, 'monthly', 'begin_checkout',
    'checkout', 'price_ranch', null, 0);
  if result->>'code' <> 'offer_expired' then raise exception 'Expired checkout accepted: %', result; end if;

  -- Removing the purchased workspace does not erase account campaign history
  -- or its one-time claim; no restrictive FK may block workspace deletion.
  delete from public.workspaces where id = ws_other;
  if not exists(select 1 from public.account_upgrade_discount_claims where user_id = owner_id) then
    raise exception 'Workspace deletion reset the account promotion.';
  end if;
  insert into public.account_deletion_holds(workspace_id, user_id, created_at) values(ws_id, owner_id, now());
  result := public.xbar_upgrade_offer_action(owner_id, ws_id, 'ranchOps', gen_random_uuid(), 'monthly', 'attempt');
  if result->>'code' <> 'account_deletion_in_progress' then raise exception 'Deletion fence bypassed: %', result; end if;
end;
$check$;
rollback;
