-- Administrative connection only; every user, workspace, membership,
-- invitation and hold is rolled back. Drives the real hold RPC, the real
-- refusal trigger and the real invitation-acceptance RPC.
--
-- What this proves (audit F03, migration 20261002100000):
--   * A private workspace is held; an invitation accepted after the hold is
--     refused with a reason, and no membership is created -- so deleting the
--     owner can no longer take a just-joined member's ranch with it.
--   * A new invitation into a held workspace is refused.
--   * Releasing the hold (a failed auth delete) restores normal access.
--   * A workspace with another active member is never held: the RPC reports
--     it as shared and records no hold at all.
--   * A hold older than 15 minutes is ignored, so a request that died
--     mid-deletion cannot close a ranch for good.
--   * Signed-in clients cannot place or lift holds.
begin;
do $check$
declare
  owner_id uuid := gen_random_uuid();
  invitee_id uuid := gen_random_uuid();
  partner_id uuid := gen_random_uuid();
  private_ws uuid := gen_random_uuid();
  shared_ws uuid := gen_random_uuid();
  other_owner uuid := gen_random_uuid();
  result jsonb;
  accepted jsonb;
  holds integer;
begin
  insert into auth.users (id, email, email_confirmed_at)
  select id, id::text || '@example.invalid', now()
  from unnest(array[owner_id, invitee_id, partner_id, other_owner]) as id;

  insert into public.workspaces (id, owner_user_id, workspace_key) values
    (private_ws, owner_id, private_ws::text);
  insert into public.workspace_profiles (workspace_id) values (private_ws);
  insert into public.workspace_subscription_profiles (workspace_id, tier, billing_state)
  values (private_ws, 'Professional', 'Active');
  insert into public.workspace_invitations (workspace_id, invitation_id, email, role, status)
  values (private_ws, 'invite-race', invitee_id::text || '@example.invalid', 'Ranch Manager', 'pending');

  -- 1. Hold, then the invitee tries to accept.
  result := public.xbar_hold_owned_workspaces_for_deletion(owner_id);
  if (result ->> 'ok')::boolean is not true then raise exception 'A private workspace was not held: %', result; end if;

  perform set_config('request.jwt.claim.sub', invitee_id::text, true);
  set local role authenticated;
  begin
    accepted := public.xbar_accept_workspace_invitation(private_ws, 'invite-race');
    raise exception 'An invitation was accepted into a workspace held for deletion';
  exception when raise_exception then
    if sqlerrm not like 'This ranch is being closed%' then raise; end if;
  end;
  reset role;
  if exists (select 1 from public.workspace_memberships where workspace_id = private_ws and user_id = invitee_id) then
    raise exception 'A membership was created in a held workspace';
  end if;

  -- 2. No new invitation either.
  begin
    insert into public.workspace_invitations (workspace_id, invitation_id, email, role, status)
    values (private_ws, 'invite-late', 'late@example.invalid', 'Ranch Manager', 'pending');
    raise exception 'An invitation was created in a workspace held for deletion';
  exception when raise_exception then
    if sqlerrm not like 'This ranch is being closed%' then raise; end if;
  end;

  -- 3. A failed auth delete releases the hold, and access works again.
  if public.xbar_release_account_deletion_holds(owner_id) <> 1 then raise exception 'The hold was not released'; end if;
  perform set_config('request.jwt.claim.sub', invitee_id::text, true);
  set local role authenticated;
  accepted := public.xbar_accept_workspace_invitation(private_ws, 'invite-race');
  reset role;
  if accepted is null then raise exception 'Access did not come back after the hold was released'; end if;

  -- 4. Now shared: never held, and nothing recorded.
  result := public.xbar_hold_owned_workspaces_for_deletion(owner_id);
  if (result ->> 'ok')::boolean is not false then raise exception 'A shared workspace was held: %', result; end if;
  if not (result -> 'shared') ? private_ws::text then raise exception 'The shared workspace was not named: %', result; end if;
  select count(*) into holds from public.account_deletion_holds where user_id = owner_id;
  if holds <> 0 then raise exception 'A refused hold still recorded % hold(s)', holds; end if;

  -- 5. A stale hold does not close a ranch for good.
  insert into public.workspaces (id, owner_user_id, workspace_key) values (shared_ws, other_owner, shared_ws::text);
  insert into public.workspace_profiles (workspace_id) values (shared_ws);
  insert into public.workspace_subscription_profiles (workspace_id, tier, billing_state)
  values (shared_ws, 'Professional', 'Active');
  insert into public.account_deletion_holds (workspace_id, user_id, created_at)
  values (shared_ws, other_owner, now() - interval '20 minutes');
  insert into public.workspace_memberships (workspace_id, user_id, email, role, status)
  values (shared_ws, partner_id, partner_id::text || '@example.invalid', 'Ranch Manager', 'active');

  -- 6. Clients cannot place or lift holds.
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  set local role authenticated;
  begin
    perform public.xbar_hold_owned_workspaces_for_deletion(owner_id);
    raise exception 'A signed-in client placed a deletion hold';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.xbar_release_account_deletion_holds(owner_id);
    raise exception 'A signed-in client lifted a deletion hold';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.account_deletion_receipts limit 1;
    raise exception 'A signed-in client read deletion receipts';
  exception when insufficient_privilege then null;
  end;
  reset role;
end;
$check$;
rollback;
select 'PASS: a held workspace refuses acceptance and new invitations; release restores access; shared workspaces are never held; stale holds expire; clients cannot hold, release or read receipts; all fixtures rolled back' as result;
