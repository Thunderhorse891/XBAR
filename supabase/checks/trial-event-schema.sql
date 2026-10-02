-- DISPOSABLE DATABASE ONLY. Minimal tables used by the subscription event RPC.
create table public.workspace_subscription_profiles (
  workspace_id uuid primary key,
  tier text,
  billing_state text,
  monthly_rate double precision,
  billing_period text,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz
);
create table public.workspace_billing_customers (
  workspace_id uuid primary key,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  seat_count integer,
  entitlement_payload jsonb,
  updated_at timestamptz,
  checkout_lock_at timestamptz,
  checkout_lock_token text
);
create table public.workspace_subscription_events (
  workspace_id uuid,
  stripe_event_id text primary key,
  event_type text,
  stripe_event_created_at timestamptz,
  payload jsonb,
  processed_at timestamptz
);

-- The test holds this lock on a separate connection, pausing the webhook
-- AFTER its snapshot read but BEFORE its profile upsert. Trial-start can then
-- commit on a third connection. Never install this test trigger in production.
create function public.test_pause_profile_upsert() returns trigger
language plpgsql as $$
begin
  if current_setting('application_name') = 'xbar-trial-webhook-test' then
    perform pg_advisory_xact_lock(926030);
  end if;
  return new;
end;
$$;
create trigger test_pause_profile_upsert before insert
on public.workspace_subscription_profiles
for each row execute function public.test_pause_profile_upsert();
