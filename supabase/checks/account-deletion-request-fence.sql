-- Synthetic users/workspaces only. Requires the request-fence migration.
-- Run on an explicitly approved disposable database; all fixtures roll back.
begin;
do $check$
declare
  owner_id uuid := gen_random_uuid();
  other_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  ws_id uuid := gen_random_uuid();
  other_ws uuid := gen_random_uuid();
  request_a uuid := gen_random_uuid();
  request_b uuid := gen_random_uuid();
  result jsonb;
begin
  insert into auth.users (id, email) select id, id::text || '@example.invalid'
  from unnest(array[owner_id, other_id, member_id]) as id;
  insert into public.workspaces (id, owner_user_id, workspace_key) values
    (ws_id, owner_id, ws_id::text), (other_ws, other_id, other_ws::text);
  if not public.xbar_claim_checkout_lock(ws_id, now() - interval '2 minutes', 'fixture-claim') then
    raise exception 'A fresh workspace could not acquire its checkout claim';
  end if;
  result := public.xbar_hold_account_deletion_request(owner_id, request_a);
  if (result ->> 'ok')::boolean is not true then raise exception 'Private workspace not fenced: %', result; end if;

  -- A second request may not replace a live fence, even if a checkout lease ages out.
  update public.workspace_billing_customers set checkout_lock_at = now() - interval '5 minutes' where workspace_id = ws_id;
  if public.xbar_claim_checkout_lock(ws_id, now() - interval '2 minutes', 'late-checkout') then
    raise exception 'Checkout stole a lease inside a deletion fence';
  end if;
  result := public.xbar_hold_account_deletion_request(owner_id, request_b);
  if result ->> 'reason' <> 'deletion_in_progress' then raise exception 'A live request was replaced: %', result; end if;

  begin
    insert into public.workspaces (owner_user_id, workspace_key) values (owner_id, 'after-snapshot');
    raise exception 'New owned workspace escaped the deletion snapshot';
  exception when raise_exception then
    if sqlerrm not like 'Account deletion is in progress.%' then raise; end if;
  end;
  begin
    update public.workspaces set owner_user_id = owner_id where id = other_ws;
    raise exception 'Ownership moved into a deleting account';
  exception when raise_exception then
    if sqlerrm not like 'Account deletion is in progress.%' then raise; end if;
  end;
  begin
    update public.workspaces set owner_user_id = other_id where id = ws_id;
    raise exception 'Ownership moved away from a deleting account';
  exception when raise_exception then
    if sqlerrm not like 'Account deletion is in progress.%' then raise; end if;
  end;

  -- A times out; B legitimately takes over. A's late cleanup must be harmless.
  update public.account_deletion_requests set created_at = now() - interval '20 minutes' where user_id = owner_id;
  update public.account_deletion_holds set created_at = now() - interval '20 minutes' where user_id = owner_id;
  result := public.xbar_hold_account_deletion_request(owner_id, request_b);
  if (result ->> 'ok')::boolean is not true then raise exception 'Expired request could not be replaced'; end if;
  if public.xbar_release_account_deletion_request(owner_id, request_a) <> 0 then raise exception 'Stale request released B'; end if;
  if public.xbar_release_account_deletion_holds(owner_id) <> 0 then raise exception 'Legacy cleanup released B'; end if;
  if not exists (select 1 from public.account_deletion_holds where workspace_id = ws_id) then raise exception 'B lost its membership hold'; end if;
  begin
    insert into public.workspace_memberships (workspace_id, user_id, email, role, status)
    values (ws_id, member_id, 'member@example.invalid', 'Ranch Manager', 'active');
    raise exception 'Member joined after stale cleanup';
  exception when raise_exception then
    if sqlerrm not like 'This ranch is being closed%' then raise; end if;
  end;
  if public.xbar_confirm_account_deletion_request(owner_id, request_a, array[ws_id]) then raise exception 'Stale token confirmed'; end if;
  if public.xbar_confirm_account_deletion_request(owner_id, request_b, '{}'::uuid[]) then raise exception 'Wrong workspace set confirmed'; end if;
  if not public.xbar_confirm_account_deletion_request(owner_id, request_b, array[ws_id]) then raise exception 'B could not confirm'; end if;

  update public.account_deletion_requests set created_at = now() - interval '20 minutes' where user_id = owner_id;
  if public.xbar_confirm_account_deletion_request(owner_id, request_b, array[ws_id]) then raise exception 'Expired fence confirmed'; end if;
  if public.xbar_release_account_deletion_request(owner_id, request_b) <> 1 then raise exception 'B could not release its own hold'; end if;
  insert into public.workspaces (owner_user_id, workspace_key) values (owner_id, 'after-release');

  -- The new RPC preserves the original shared-record protection, including
  -- an active member whose identity is missing.
  insert into public.workspace_memberships (workspace_id, user_id, email, role, status)
  values (ws_id, member_id, 'shared@example.invalid', 'Ranch Manager', 'active');
  result := public.xbar_hold_account_deletion_request(owner_id, request_a);
  if (result ->> 'ok')::boolean is not false or not (result -> 'shared') ? ws_id::text then
    raise exception 'New request held a shared workspace: %', result;
  end if;
  insert into public.workspace_memberships (workspace_id, user_id, email, role, status)
  values (other_ws, null, 'unidentified@example.invalid', 'Ranch Manager', 'active');
  result := public.xbar_hold_account_deletion_request(other_id, request_a);
  if (result ->> 'ok')::boolean is not false then raise exception 'NULL-user membership was ignored'; end if;

  -- Even an account with no owned workspaces needs a user fence.
  result := public.xbar_hold_account_deletion_request(member_id, request_a);
  if (result ->> 'ok')::boolean is not true then raise exception 'Empty account not fenced'; end if;
  begin
    insert into public.workspaces (owner_user_id, workspace_key) values (member_id, 'empty-race');
    raise exception 'Empty account gained a workspace inside the fence';
  exception when raise_exception then
    if sqlerrm not like 'Account deletion is in progress.%' then raise; end if;
  end;
  perform public.xbar_release_account_deletion_request(member_id, request_a);

  begin
    perform public.xbar_hold_owned_workspaces_for_deletion(owner_id);
    raise exception 'Legacy protocol remained usable';
  exception when raise_exception then
    if sqlerrm not like 'Account deletion requires the request-token protocol.%' then raise; end if;
  end;
  if has_function_privilege('anon', 'public.xbar_hold_account_deletion_request(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.xbar_release_account_deletion_request(uuid,uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.xbar_confirm_account_deletion_request(uuid,uuid,uuid[])', 'EXECUTE') then
    raise exception 'A client can control the deletion fence';
  end if;
end;
$check$;
rollback;
select 'PASS: stale cleanup, live checkout, membership and workspace-growth races refused; expiry and token-owned release recover; fixtures rolled back' as result;
