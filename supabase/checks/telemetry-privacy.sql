-- Isolated synthetic PostgreSQL only. No customer records or credentials.
\set ON_ERROR_STOP on
begin;
do $check$
declare
  owner_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  ws uuid := gen_random_uuid();
  event_id uuid;
  body jsonb;
  actual jsonb;
begin
  insert into auth.users(id,email) values (owner_id,'telemetry-owner@example.invalid'),(outsider_id,'telemetry-outsider@example.invalid');
  insert into public.workspaces(id,owner_user_id,workspace_key) values(ws,owner_id,ws::text);
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  set local role authenticated;
  insert into public.runtime_events(workspace_id,user_id,event_name,payload)
  values(ws,owner_id,'navigation.page_view','{"pathname":"/share/horse?token=SYNTHETIC_NEW#code=SYNTHETIC_NEW","search":"?token=SYNTHETIC_NEW","nested":{"code":"SYNTHETIC_NEW"}}')
  returning id,payload into event_id,actual;
  if actual <> '{"pathname":"/share/horse"}'::jsonb then
    raise exception 'Direct navigation insert retained private metadata';
  end if;
  foreach body in array array[
    '{}'::jsonb, '{"pathname":null}'::jsonb, '{"pathname":12}'::jsonb,
    '{"pathname":"https://example.test/?token=SYNTHETIC"}'::jsonb,
    '{"pathname":"//example.test/?token=SYNTHETIC"}'::jsonb,
    '{"pathname":["/route?token=SYNTHETIC"]}'::jsonb
  ] loop
    insert into public.runtime_events(workspace_id,event_name,payload)
    values(ws,'navigation.page_view',body) returning payload into actual;
    if actual <> '{}'::jsonb then raise exception 'Malformed navigation payload survived'; end if;
  end loop;
  insert into public.runtime_events(workspace_id,event_name,payload)
  values(ws,'documents.saved','{"count":4}') returning payload into actual;
  if actual <> '{"count":4}'::jsonb then raise exception 'Unrelated event was changed'; end if;
  reset role;
  -- The same boundary also covers privileged service writes and updates.
  update public.runtime_events set payload='{"pathname":"/app?code=SYNTHETIC_UPDATE","hash":"SYNTHETIC_UPDATE"}'
  where id=event_id returning payload into actual;
  if actual <> '{"pathname":"/app"}'::jsonb then raise exception 'Updated navigation retained private metadata'; end if;
  if not exists(select 1 from public.runtime_events where id='eeeeeeee-0000-4000-8000-000000000001'
      and payload='{"pathname":"/share/example"}'::jsonb and created_at='2026-01-01') then
    raise exception 'Historical navigation was not scrubbed with identity/timestamp preserved';
  end if;
  if not exists(select 1 from public.runtime_events where id='eeeeeeee-0000-4000-8000-000000000002'
      and payload='{"count":3}'::jsonb and created_at='2026-01-02') then
    raise exception 'Unrelated historical event changed';
  end if;
  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  set local role authenticated;
  begin
    insert into public.runtime_events(workspace_id,event_name,payload) values(ws,'navigation.page_view','{}');
    raise exception 'Outsider inserted into another workspace';
  exception when insufficient_privilege then null;
  end;
  if exists(select 1 from public.runtime_events where workspace_id=ws) then raise exception 'Outsider read events'; end if;
  reset role;
end;
$check$;
rollback;
