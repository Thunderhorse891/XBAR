-- Disposable local database or explicitly approved transactional integration
-- test ONLY. Creates synthetic fixtures; every change is rolled back.
-- Load the real limit definitions, access helper and proposed migration first.
begin;
do $check$
declare
  owner_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  workspace uuid := gen_random_uuid();
  f text;
  who uuid;
  result bigint;
begin
  insert into auth.users(id,email) select id,id::text || '@example.invalid'
    from unnest(array[owner_id,member_id,outsider_id]) id;
  insert into public.workspaces(id,owner_user_id,workspace_key) values(workspace,owner_id,workspace::text);
  insert into public.workspace_subscription_profiles(workspace_id,tier,billing_state) values(workspace,'Enterprise','Active');
  insert into public.workspace_memberships(workspace_id,user_id,email,role,status)
    values(workspace,member_id,member_id::text || '@example.invalid','Ranch Manager','active');
  insert into public.documents(workspace_id,document_id,size_bytes) values(workspace,'synthetic-doc',123);
  insert into public.sale_packets(workspace_id,packet_id,size_bytes) values(workspace,'synthetic-packet',456);

  foreach who in array array[owner_id,member_id] loop
    perform set_config('request.jwt.claim.sub',who::text,true);
    perform set_config('request.jwt.claim.role','authenticated',true);
    set local role authenticated;
    result := public.xbar_workspace_storage_bytes(workspace);
    if result <> 579 then raise exception 'Owner/member storage mismatch: %',result; end if;
    foreach f in array array['xbar_subscription_limits','xbar_commercial_limits'] loop
      begin
        execute format('select * from public.%I($1)',f) using workspace;
        raise exception 'Client directly invoked internal calculator %',f;
      exception when insufficient_privilege then null;
      end;
    end loop;
    reset role;
  end loop;

  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  set local role authenticated;
  begin
    perform public.xbar_workspace_storage_bytes(workspace);
    raise exception 'Nonmember read workspace storage';
  exception when insufficient_privilege then null;
  end;
  -- An unknown workspace must fail the same way, not reveal existence.
  begin
    perform public.xbar_workspace_storage_bytes(gen_random_uuid());
    raise exception 'Nonmember queried unknown workspace';
  exception when insufficient_privilege then null;
  end;
  reset role;

  update public.workspace_memberships set status='inactive' where workspace_id=workspace;
  perform set_config('request.jwt.claim.sub',member_id::text,true);
  set local role authenticated;
  begin
    perform public.xbar_workspace_storage_bytes(workspace);
    raise exception 'Inactive member read storage';
  exception when insufficient_privilege then null;
  end;
  reset role;

  -- The real seat trigger must still calculate limits before an invitee has
  -- membership. This insert uses a synthetic no-RLS fixture, not production
  -- authorization: it proves the internal definer call survives revoked grants.
  perform set_config('request.jwt.claim.sub',outsider_id::text,true);
  set local role authenticated;
  insert into public.workspace_memberships(workspace_id,user_id,email,role,status)
    values(workspace,outsider_id,outsider_id::text || '@example.invalid','Ranch Manager','active');
  reset role;
  if not exists(select 1 from public.workspace_memberships where workspace_id=workspace and user_id=outsider_id)
    then raise exception 'Seat trigger blocked pre-membership limit lookup'; end if;

  perform set_config('request.jwt.claim.sub','',true);
  perform set_config('request.jwt.claim.role','anon',true);
  set local role anon;
  foreach f in array array['xbar_workspace_storage_bytes','xbar_subscription_limits','xbar_commercial_limits'] loop
    begin
      execute format('select * from public.%I($1)',f) using workspace;
      raise exception 'Anon invoked %',f;
    exception when insufficient_privilege then null;
    end;
  end loop;
  reset role;

  perform set_config('request.jwt.claim.role','service_role',true);
  set local role service_role;
  if public.xbar_workspace_storage_bytes(workspace) <> 579 then raise exception 'Service storage failed'; end if;
  if (select seat_limit from public.xbar_subscription_limits(workspace)) <> 60 then raise exception 'Service seat limits changed'; end if;
  if (select horse_limit from public.xbar_commercial_limits(workspace)) <> 2000 then raise exception 'Service horse limits changed'; end if;
  reset role;
end;
$check$;
rollback;
