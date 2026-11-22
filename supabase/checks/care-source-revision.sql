-- Disposable database only, after staff-write policies and source-revision DDL.
begin;
do $check$
declare
  owner_id uuid := gen_random_uuid();
  medical_id uuid := gen_random_uuid();
  ws uuid := '00000000-0000-0000-0000-000000000001';
  other_ws uuid := '00000000-0000-0000-0000-000000000002';
  pinned text;
  page_end uuid;
  size integer;
  affected integer;
begin
  insert into auth.users(id,email,email_confirmed_at)
  values (owner_id,'owner@example.invalid',now()), (medical_id,'staff@example.invalid',now());
  insert into public.workspaces(id,owner_user_id,workspace_key) values
    (ws,owner_id,'first'), (other_ws,owner_id,'second');
  insert into public.workspace_memberships(workspace_id,user_id,email,role,status)
  values(ws,medical_id,'staff@example.invalid','Medical Lead','active');
  insert into public.horses(workspace_id,horse_id,name,payload)
  values(ws,'one','Synthetic','{"medicalTimeline":[]}'), (other_ws,'two','Synthetic','{}');
  if exists(select from public.xbar_private_care_source_page()) then
    raise exception 'Unenrolled workspace leaked into the queue';
  end if;
  insert into public.xbar_private_care_source_revisions(workspace_id) values(ws);
  update public.horses set payload = '{"medicalTimeline":[{"id":"planned","completionState":"planned"}]}'
    where workspace_id = ws;
  if (select revision from public.xbar_private_care_source_revisions where workspace_id = ws) <> 1 then
    raise exception 'Disabled source changed';
  end if;
  update public.xbar_private_care_source_revisions set enabled = true where workspace_id = ws;
  select revision into strict pinned from public.xbar_private_care_source_page() where workspace_id = ws;

  perform set_config('request.jwt.claim.sub', medical_id::text, true);
  set local role authenticated;
  begin
    perform * from public.xbar_private_care_source_page();
    raise exception 'Authenticated access to private queue';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.xbar_private_care_source_revisions set enabled = false where workspace_id = ws;
    raise exception 'Authenticated enrollment write';
  exception when insufficient_privilege then null;
  end;
  update public.horses set payload = '{"medicalTimeline":[{"id":"planned","completionState":"completed"}]}'
    where workspace_id = ws;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Care completion did not reach the authoritative horse'; end if;
  update public.horses set payload = '{}' where workspace_id = other_ws;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Medical staff changed another tenant'; end if;
  reset role;
  if (select revision from public.xbar_private_care_source_page() where workspace_id = ws) <> (pinned::bigint + 1)::text then
    raise exception 'Care completion did not invalidate the pinned source';
  end if;
  select revision into strict pinned from public.xbar_private_care_source_page() where workspace_id = ws;
  update public.horses set updated_at = updated_at + interval '1 second' where workspace_id = ws;
  if (select revision from public.xbar_private_care_source_page() where workspace_id = ws) <> pinned then
    raise exception 'Identical save retry generated new work';
  end if;
  begin
    update public.horses set payload = '{}' where workspace_id = ws;
    raise exception 'Intentional source transaction rollback';
  exception when raise_exception then
    if sqlerrm <> 'Intentional source transaction rollback' then raise; end if;
  end;
  if (select revision from public.xbar_private_care_source_page() where workspace_id = ws) <> pinned then
    raise exception 'Rolled-back source change generated work';
  end if;
  update public.workspace_memberships set status = 'revoked' where workspace_id = ws;
  if (select revision from public.xbar_private_care_source_page() where workspace_id = ws) <> (pinned::bigint + 1)::text then
    raise exception 'Membership revocation did not invalidate pinned source';
  end if;

  insert into public.workspaces(id,owner_user_id,workspace_key)
    select lpad(i::text,32,'0')::uuid, owner_id, 'page-' || i from generate_series(3,202) i;
  insert into public.xbar_private_care_source_revisions(workspace_id,enabled)
    select id,true from public.workspaces where id <> ws;
  set local role service_role;
  select count(*), (array_agg(workspace_id order by workspace_id desc))[1] into size,page_end
    from public.xbar_private_care_source_page(null,9999);
  if size <> 200 or (select count(*) from public.xbar_private_care_source_page(page_end)) <> 2 then
    raise exception 'Bounded page did not advance across all 202 tenants';
  end if;
  reset role;
  update public.xbar_private_care_source_revisions set enabled = false where workspace_id = ws;
  if exists(select from public.xbar_private_care_source_page() where workspace_id = ws) then
    raise exception 'Disabled enrollment remained discoverable';
  end if;
  update public.xbar_private_care_source_revisions set enabled = true where workspace_id = ws;
  if (select revision from public.xbar_private_care_source_page() where workspace_id = ws) <> (pinned::bigint + 3)::text then
    raise exception 'Disable and re-enable did not fence old revisions';
  end if;
end;
$check$;
rollback;
