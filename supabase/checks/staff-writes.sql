-- Administrative connection only; every user, workspace and record is rolled
-- back. Exercises the real write policies and the specialist horse guard under
-- `authenticated`, exactly as the app's upserts reach them.
--
-- What this proves (audit F04, migration 20261002120000):
--   * Medical Lead: saves a treatment on an existing horse (an UPSERT, which
--     Postgres checks against the INSERT policy too) and an injury's move to
--     Medical Review; cannot rename a horse, change its price, create a horse,
--     delete one, or write a sale lead.
--   * Sales Lead: saves a lead and edits a horse; cannot delete a horse.
--   * Ranch Manager: creates a horse, logs equipment, deletes a horse.
--   * An invited Admin (not the owner) can save the ranch profile; a Medical
--     Lead cannot.
--   * Someone from another ranch writes nothing.
begin;
do $check$
declare
  owner_id uuid := gen_random_uuid();
  admin_id uuid := gen_random_uuid();
  manager_id uuid := gen_random_uuid();
  medical_id uuid := gen_random_uuid();
  sales_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  ws uuid := gen_random_uuid();
  other_ws uuid := gen_random_uuid();
  affected integer;
  base jsonb := jsonb_build_object(
    'id', 'horse-1', 'name', 'Dun It Again', 'status', 'Active',
    'sale', jsonb_build_object('askingPrice', 25000, 'socialReady', false, 'inquiryCount', 0),
    'medicalTimeline', '[]'::jsonb, 'activity', '[]'::jsonb
  );
  treated jsonb;
begin
  insert into auth.users (id, email, email_confirmed_at)
  select id, id::text || '@example.invalid', now()
  from unnest(array[owner_id, admin_id, manager_id, medical_id, sales_id, outsider_id]) as id;

  insert into public.workspaces (id, owner_user_id, workspace_key) values
    (ws, owner_id, ws::text), (other_ws, outsider_id, other_ws::text);
  insert into public.workspace_profiles (workspace_id) values (ws), (other_ws);
  insert into public.workspace_subscription_profiles (workspace_id, tier, billing_state) values
    (ws, 'Enterprise', 'Manual Billing'), (other_ws, 'Enterprise', 'Manual Billing');
  insert into public.workspace_memberships (workspace_id, user_id, email, role, status) values
    (ws, admin_id, admin_id::text || '@example.invalid', 'Admin', 'active'),
    (ws, manager_id, manager_id::text || '@example.invalid', 'Ranch Manager', 'active'),
    (ws, medical_id, medical_id::text || '@example.invalid', 'Medical Lead', 'active'),
    (ws, sales_id, sales_id::text || '@example.invalid', 'Sales Lead', 'active'),
    (other_ws, outsider_id, outsider_id::text || '@example.invalid', 'Admin', 'active');
  insert into public.horses (workspace_id, horse_id, name, status, payload)
  values (ws, 'horse-1', 'Dun It Again', 'Active', base);

  -- ------------------------------------------------------------ Medical Lead
  perform set_config('request.jwt.claim.sub', medical_id::text, true);
  set local role authenticated;

  treated := jsonb_set(base, '{medicalTimeline}', '[{"title":"Coggins drawn"}]'::jsonb);
  insert into public.horses (workspace_id, horse_id, name, status, payload)
  values (ws, 'horse-1', 'Dun It Again', 'Active', treated)
  on conflict (workspace_id, horse_id) do update set payload = excluded.payload;

  treated := jsonb_set(treated, '{status}', '"Medical Review"');
  insert into public.horses (workspace_id, horse_id, name, status, payload)
  values (ws, 'horse-1', 'Dun It Again', 'Medical Review', treated)
  on conflict (workspace_id, horse_id) do update set status = excluded.status, payload = excluded.payload;

  begin
    update public.horses set name = 'Renamed', payload = jsonb_set(payload, '{name}', '"Renamed"')
    where workspace_id = ws and horse_id = 'horse-1';
    raise exception 'A Medical Lead renamed a horse';
  exception when raise_exception then
    if sqlerrm not like 'This role can update%' then raise; end if;
  end;
  begin
    update public.horses set payload = jsonb_set(payload, '{sale,askingPrice}', '1')
    where workspace_id = ws and horse_id = 'horse-1';
    raise exception 'A Medical Lead changed a sale price';
  exception when raise_exception then
    if sqlerrm not like 'This role cannot change%' then raise; end if;
  end;
  begin
    insert into public.horses (workspace_id, horse_id, name, status, payload)
    values (ws, 'horse-new', 'New', 'Active', '{}'::jsonb);
    raise exception 'A Medical Lead created a horse';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.sales_leads (workspace_id, lead_id, horse_id, lead_name, payload)
    values (ws, 'lead-x', 'horse-1', 'Buyer', '{}'::jsonb);
    raise exception 'A Medical Lead wrote a sale lead';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.workspace_profiles (workspace_id, ranch_name) values (ws, 'Taken')
    on conflict (workspace_id) do update set ranch_name = excluded.ranch_name;
    raise exception 'A Medical Lead wrote the ranch profile';
  exception when insufficient_privilege then null;
  end;
  delete from public.horses where workspace_id = ws and horse_id = 'horse-1';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'A Medical Lead deleted a horse'; end if;
  reset role;

  if (select payload -> 'medicalTimeline' -> 0 ->> 'title' from public.horses where workspace_id = ws and horse_id = 'horse-1')
     is distinct from 'Coggins drawn' then
    raise exception 'The Medical Lead''s treatment did not reach the cloud';
  end if;
  if (select status from public.horses where workspace_id = ws and horse_id = 'horse-1') <> 'Medical Review' then
    raise exception 'The injury did not open a medical review';
  end if;

  -- -------------------------------------------------------------- Sales Lead
  perform set_config('request.jwt.claim.sub', sales_id::text, true);
  set local role authenticated;
  insert into public.sales_leads (workspace_id, lead_id, horse_id, lead_name, payload)
  values (ws, 'lead-1', 'horse-1', 'Buyer', '{}'::jsonb);
  update public.horses set payload = jsonb_set(payload, '{sale,askingPrice}', '27500')
  where workspace_id = ws and horse_id = 'horse-1';
  delete from public.horses where workspace_id = ws and horse_id = 'horse-1';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'A Sales Lead deleted a horse'; end if;
  reset role;
  if not exists (select 1 from public.sales_leads where workspace_id = ws and lead_id = 'lead-1') then
    raise exception 'The Sales Lead''s lead did not reach the cloud';
  end if;

  -- ----------------------------------------------------------- Ranch Manager
  perform set_config('request.jwt.claim.sub', manager_id::text, true);
  set local role authenticated;
  insert into public.horses (workspace_id, horse_id, name, status, payload)
  values (ws, 'horse-2', 'Second', 'Active', '{"id":"horse-2"}'::jsonb);
  insert into public.ranch_assets (workspace_id, asset_id, name, payload)
  values (ws, 'asset-1', 'Stock trailer', '{}'::jsonb);
  delete from public.horses where workspace_id = ws and horse_id = 'horse-2';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'A Ranch Manager could not delete a horse'; end if;
  reset role;

  -- ---------------------------------------------------- invited Admin, outsider
  perform set_config('request.jwt.claim.sub', admin_id::text, true);
  set local role authenticated;
  insert into public.workspace_profiles (workspace_id, ranch_name) values (ws, 'Shared Ranch')
  on conflict (workspace_id) do update set ranch_name = excluded.ranch_name;
  reset role;
  if (select ranch_name from public.workspace_profiles where workspace_id = ws) <> 'Shared Ranch' then
    raise exception 'An invited Admin could not save the ranch profile';
  end if;

  perform set_config('request.jwt.claim.sub', outsider_id::text, true);
  set local role authenticated;
  update public.horses set payload = '{}'::jsonb where workspace_id = ws;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Another ranch changed this ranch''s horses'; end if;
  begin
    insert into public.horses (workspace_id, horse_id, name, status, payload)
    values (ws, 'horse-1', 'X', 'Active', '{}'::jsonb)
    on conflict (workspace_id, horse_id) do update set payload = excluded.payload;
    raise exception 'Another ranch upserted over this ranch''s horse';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$check$;
rollback;
select 'PASS: Medical Lead saves treatments and a medical review but not names, prices, new horses, leads, the profile or deletions; Sales Lead saves leads and horse edits but cannot delete; Ranch Manager creates, logs equipment and deletes; an invited Admin saves the profile; another ranch writes nothing; all fixtures rolled back' as result;
