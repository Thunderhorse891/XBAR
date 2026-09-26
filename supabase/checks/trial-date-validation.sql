-- Disposable-database regression check; load the trial migrations first.
-- Invalid persisted dates must deny entitlement, never abort a capacity check.
do $$
declare
  bad_date text;
  date_field text;
  trial_payload jsonb;
  workspace uuid := gen_random_uuid();
  limits record;
begin
  insert into public.workspace_subscription_profiles (workspace_id, tier, billing_state, payload)
  values (workspace, 'Starter', 'Inactive', '{}'::jsonb);
  foreach bad_date in array array[
    '2026-99-24T12:00:00Z',
    '2026-02-30T12:00:00Z',
    '2026-09-24T99:00:00Z',
    '2026-09-24T12:00:00garbage',
    'garbage',
    ''
  ] loop
    foreach date_field in array array['startedAt', 'endsAt'] loop
      trial_payload := jsonb_build_object('trial', jsonb_build_object(
        'plan', 'Professional',
        'startedAt', now() - interval '1 day',
        'endsAt', now() + interval '1 day'
      ));
      trial_payload := jsonb_set(trial_payload, array['trial', date_field], to_jsonb(bad_date));
      if public.xbar_trial_active(trial_payload) is distinct from false then
        raise exception 'invalid % granted entitlement: %', date_field, bad_date;
      end if;
      update public.workspace_subscription_profiles set payload = trial_payload where workspace_id = workspace;
      select * into limits from public.xbar_commercial_limits(workspace);
      if limits.horse_limit <> 5 then
        raise exception 'invalid % changed the Starter horse limit', date_field;
      end if;
      select * into limits from public.xbar_subscription_limits(workspace);
      if limits.seat_limit <> 1 then
        raise exception 'invalid % changed the Starter seat limit', date_field;
      end if;
    end loop;
  end loop;
  delete from public.workspace_subscription_profiles where workspace_id = workspace;
end
$$;
