-- Isolated synthetic PostgreSQL only. No stored objects or customer records.
-- Staff horse edits must not turn an unreviewed image into buyer-facing media.
\set ON_ERROR_STOP on
begin;
do $check$
declare
  owner_id uuid := gen_random_uuid();
  manager_id uuid := gen_random_uuid();
  sales_id uuid := gen_random_uuid();
  member_owner_id uuid := gen_random_uuid();
  ws uuid := gen_random_uuid();
  reviewer_ws uuid := gen_random_uuid();
  caller uuid;
  identity_bypasses text[] := array[]::text[];
  destination_reviewed boolean := false;
  pending jsonb := '{"gallery":[{"id":"photo","storagePath":"stored/photo.jpg","url":"","status":"Pending"}]}'::jsonb;
  approved jsonb := jsonb_set(pending, '{gallery,0,status}', '"Approved"');
begin
  insert into auth.users(id,email)
    select id, id::text || '@example.invalid' from unnest(array[owner_id,manager_id,sales_id,member_owner_id]) id;
  insert into public.workspaces(id,owner_user_id,workspace_key) values
    (ws,owner_id,ws::text),(reviewer_ws,manager_id,reviewer_ws::text);
  insert into public.workspace_subscription_profiles(workspace_id,tier,billing_state)
    values(ws,'Enterprise','Manual Billing'),(reviewer_ws,'Enterprise','Manual Billing');
  insert into public.workspace_memberships(workspace_id,user_id,email,role,status) values
    (ws,manager_id,'manager@example.invalid','Ranch Manager','active'),
    (ws,sales_id,'sales@example.invalid','Sales Lead','active'),
    (ws,member_owner_id,'member-owner@example.invalid','Owner','active');
  insert into public.horses(workspace_id,horse_id,name,payload) values(ws,'photo-horse','Synthetic',pending);

  foreach caller in array array[manager_id,member_owner_id] loop
    perform set_config('request.jwt.claim.sub',caller::text,true);
    set local role authenticated;
    begin
      update public.horses set payload=approved where workspace_id=ws and horse_id='photo-horse';
      raise exception 'Non-reviewer approved an existing photo through a horse write';
    exception when raise_exception then
      if sqlerrm <> 'Sale media approval requires an Admin or Sales Lead.' then raise; end if;
    end;
    reset role;
  end loop;

  perform set_config('request.jwt.claim.sub',manager_id::text,true);
  set local role authenticated;
  begin
    insert into public.horses(workspace_id,horse_id,name,payload) values(ws,'forged-new','New',approved);
    raise exception 'Non-reviewer inserted a preapproved photo';
  exception when raise_exception then
    if sqlerrm <> 'Sale media approval requires an Admin or Sales Lead.' then raise; end if;
  end;
  insert into public.horses(workspace_id,horse_id,name,payload) values(ws,'pending-new','New',pending);
  update public.horses set name='Legitimate staff edit' where workspace_id=ws and horse_id='photo-horse';
  -- Actual staff USING/WITH CHECK policies allow edits in both workspaces.
  -- Approval obtained as the owner in B must not be carried back into A,
  -- where this same caller is only a Ranch Manager. Each nested block rolls
  -- its attempted round trip back, including when detecting the old bypass.
  begin
    update public.horses set workspace_id=reviewer_ws,payload=approved
      where workspace_id=ws and horse_id='photo-horse';
    if not found then raise exception 'Authorized destination review moved no row'; end if;
    destination_reviewed := true;
    update public.horses set workspace_id=ws
      where workspace_id=reviewer_ws and horse_id='photo-horse';
    if not found then raise exception 'Return move exercised no row'; end if;
    raise exception 'Workspace identity bypass';
  exception when raise_exception then
    if sqlerrm = 'Workspace identity bypass' then
      identity_bypasses := array_append(identity_bypasses,sqlerrm);
    elsif sqlerrm <> 'Sale media approval requires an Admin or Sales Lead.' then raise;
    end if;
  end;
  if not destination_reviewed then raise exception 'Authorized destination review was refused'; end if;
  -- Pending transfers and horse-key changes remain ordinary authorized staff
  -- writes. Approval is the boundary here, not a new general transfer policy.
  update public.horses set workspace_id=reviewer_ws where workspace_id=ws and horse_id='pending-new';
  if not found then raise exception 'Pending outward move wrote no row'; end if;
  update public.horses set workspace_id=ws,horse_id='pending-renamed'
    where workspace_id=reviewer_ws and horse_id='pending-new';
  if not found then raise exception 'Pending return/key change wrote no row'; end if;
  reset role;

  -- Sales Lead is authorized to approve. The API separately checks the exact
  -- expected image and compare-and-set acknowledgment before reporting success.
  perform set_config('request.jwt.claim.sub',sales_id::text,true);
  set local role authenticated;
  update public.horses set payload=approved where workspace_id=ws and horse_id='photo-horse';
  reset role;
  if not exists(select 1 from public.horses where workspace_id=ws and horse_id='photo-horse' and payload=approved)
    then raise exception 'Authorized approval did not persist'; end if;

  perform set_config('request.jwt.claim.sub',manager_id::text,true);
  set local role authenticated;
  update public.horses set name='Approved photo preserved' where workspace_id=ws and horse_id='photo-horse';
  if not found then raise exception 'Ordinary approved-source edit wrote no row'; end if;
  begin
    update public.horses set horse_id='different-horse' where workspace_id=ws and horse_id='photo-horse';
    if not found then raise exception 'Horse-key change exercised no row'; end if;
    raise exception 'Horse identity bypass';
  exception when raise_exception then
    if sqlerrm = 'Horse identity bypass' then
      identity_bypasses := array_append(identity_bypasses,sqlerrm);
    elsif sqlerrm <> 'Sale media approval requires an Admin or Sales Lead.' then raise;
    end if;
  end;
  if cardinality(identity_bypasses) > 0 then
    raise exception 'Retained approval bypasses: %',array_to_string(identity_bypasses,', ');
  end if;
  foreach pending in array array[
    jsonb_set(approved,'{gallery,0,storagePath}','"stored/replacement.jpg"'),
    jsonb_set(approved,'{gallery,0,url}','"https://example.invalid/replacement.jpg"'),
    jsonb_set(approved,'{gallery,0,id}','"replacement"')
  ] loop
    begin
      update public.horses set payload=pending where workspace_id=ws and horse_id='photo-horse';
      raise exception 'Replacement image inherited an old approval';
    exception when raise_exception then
      if sqlerrm <> 'Sale media approval requires an Admin or Sales Lead.' then raise; end if;
    end;
  end loop;
  -- A replacement awaiting review remains a legitimate upload/edit.
  update public.horses set payload=jsonb_set(pending,'{gallery,0,status}','"Pending"')
    where workspace_id=ws and horse_id='photo-horse';
  reset role;
end;
$check$;
rollback;
select 'PASS: staff edits and pending uploads/transfers persist; unauthorized new approvals and replacement-image/workspace/horse identity approval reuse are refused; authorized Sales Lead approval persists; all fixtures rolled back' as result;
