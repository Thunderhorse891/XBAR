-- Read-only production schema gate. Does not create users or fixture records.
-- Run with a database administrator, separately from the configuration-only
-- /api/health endpoint. Any missing prerequisite raises an error.
do $$
declare
  event_rpc regprocedure := to_regprocedure('public.xbar_apply_subscription_event(uuid,text,text,timestamptz,jsonb,text,text,double precision,jsonb,text,text,text,integer,boolean,text)');
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
      and table_name = 'workspace_subscription_profiles' and column_name = 'billing_period') then
    raise exception 'Missing billing_period';
  end if;
  if event_rpc is null or (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='xbar_apply_subscription_event') <> 1 then
    raise exception 'Missing or ambiguous billing RPC';
  end if;
  if has_function_privilege('anon',event_rpc,'execute') or has_function_privilege('authenticated',event_rpc,'execute') then
    raise exception 'Billing RPC exposed outside service role';
  end if;
  if not public.xbar_trial_active(jsonb_build_object('trial',jsonb_build_object(
      'plan','Professional','startedAt',now()-interval '1 day','endsAt',now()+interval '13 days'))) then
    raise exception 'Valid trial not recognized';
  end if;
  if public.xbar_trial_active('{"trial":{"plan":"Professional","startedAt":"2026-09-24T12:00:00+99:00","endsAt":"2026-10-08T12:00:00Z"}}'::jsonb) then
    raise exception 'Invalid trial accepted';
  end if;
  if not exists (select 1 from storage.buckets where id='horse-media' and public=false) then
    raise exception 'Horse media bucket missing or public';
  end if;
  if not exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
      and policyname='horse media select workspace' and cmd='SELECT') then
    raise exception 'Horse media read policy missing';
  end if;
end $$;
select 'launch schema prerequisites verified; payment and email workflows require separate checks' as result;
