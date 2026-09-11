-- Administrative connection only. Synthetic auth users have no credentials;
-- every user, workspace, membership, invitation and record is rolled back.
-- Exercises real RLS under authenticated, not service-role bypass.
begin;
do $check$
declare
  owner_id uuid := gen_random_uuid();
  member_id uuid := gen_random_uuid();
  outsider_id uuid := gen_random_uuid();
  workspace uuid := gen_random_uuid();
  member_email text := member_id::text || '@example.invalid';
  outsider_email text := outsider_id::text || '@example.invalid';
  affected integer;
  accepted jsonb;
begin
  insert into auth.users (id, email, email_confirmed_at) values
    (owner_id, owner_id::text || '@example.invalid', now()),
    (member_id, member_email, now()), (outsider_id, outsider_email, now());

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'email', owner_id::text || '@example.invalid')::text, true);
  set local role authenticated;
  insert into public.workspaces (id, owner_user_id, workspace_key) values (workspace, owner_id, workspace::text);
  if (select count(*) from public.workspaces where id = workspace) <> 1 then raise exception 'Owner cannot read created workspace'; end if;
  insert into public.workspace_memberships (workspace_id, user_id, email, role)
  values (workspace, owner_id, owner_id::text || '@example.invalid', 'Admin');
  insert into public.workspace_profiles (workspace_id) values (workspace);
  reset role;
  -- Seat capacity is independent of the authorization cases below.
  insert into public.workspace_subscription_profiles (workspace_id, tier, billing_state)
  values (workspace, 'Professional', 'Manual Billing');
  set local role authenticated;
  insert into public.horses (workspace_id, horse_id, name) values (workspace, 'rls-fixture', 'RLS fixture');
  insert into public.workspace_invitations (workspace_id, invitation_id, email, role)
  values (workspace, 'member-invite', member_email, 'Owner'), (workspace, 'outsider-invite', outsider_email, 'Admin');
  reset role;

  perform set_config('request.jwt.claim.sub', member_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', member_id, 'email', member_email)::text, true);
  set local role authenticated;
  if exists (select 1 from public.workspaces where id = workspace) then raise exception 'Uninvited user read workspace'; end if;
  if exists (select 1 from public.horses where workspace_id = workspace) then raise exception 'Uninvited user read horses'; end if;
  begin
    insert into public.workspace_memberships (workspace_id, user_id, email, role)
    values (workspace, member_id, member_email, 'Admin');
    raise exception 'User self-enrolled as Admin';
  exception when insufficient_privilege then null;
  end;
  update public.workspace_invitations set role = 'Admin' where workspace_id = workspace and invitation_id = 'member-invite';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Invitee changed assigned role'; end if;
  if public.xbar_accept_workspace_invitation(workspace, 'outsider-invite') is not null then raise exception 'Wrong recipient accepted invite'; end if;
  accepted := public.xbar_accept_workspace_invitation(workspace, 'member-invite');
  if accepted is null or accepted->>'role' <> 'Owner' then raise exception 'Valid recipient could not accept assigned role'; end if;
  if public.xbar_accept_workspace_invitation(workspace, 'member-invite') is not null then raise exception 'Accepted invite replayed'; end if;
  if (select count(*) from public.workspaces where id = workspace) <> 1 then raise exception 'Member cannot read workspace'; end if;
  if (select count(*) from public.horses where workspace_id = workspace) <> 1 then raise exception 'Member cannot read horses'; end if;
  update public.workspace_memberships set role = 'Admin' where workspace_id = workspace and user_id = member_id;
  get diagnostics affected = row_count;
  if affected <> 0 or public.xbar_can_manage_workspace(workspace) then raise exception 'Member promoted own role'; end if;
  update public.horses set name = 'Not permitted' where workspace_id = workspace;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Read-only member changed horse'; end if;
  reset role;

  -- A current unconfirmed account cannot consume a matching invite, even if
  -- a token claims the email. Revoked invitations also cannot be consumed.
  update auth.users set email_confirmed_at = null where id = outsider_id;
  perform set_config('request.jwt.claim.sub', outsider_id::text, true);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', outsider_id, 'email', outsider_email)::text, true);
  set local role authenticated;
  if public.xbar_accept_workspace_invitation(workspace, 'outsider-invite') is not null then raise exception 'Unconfirmed user accepted invite'; end if;
  reset role;
  update auth.users set email_confirmed_at = now() where id = outsider_id;
  update public.workspace_invitations set status = 'revoked' where workspace_id = workspace and invitation_id = 'outsider-invite';
  set local role authenticated;
  if public.xbar_accept_workspace_invitation(workspace, 'outsider-invite') is not null then raise exception 'Revoked invite accepted'; end if;
  reset role;
  update public.workspace_invitations set status = 'pending' where workspace_id = workspace and invitation_id = 'outsider-invite';
  set local role authenticated;
  accepted := public.xbar_accept_workspace_invitation(workspace, 'outsider-invite');
  if accepted is null or accepted->>'role' <> 'Admin' or not public.xbar_can_manage_workspace(workspace) then raise exception 'Assigned Admin cannot manage workspace'; end if;
  update public.horses set name = 'Authorized Admin update' where workspace_id = workspace;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Admin cannot change horse'; end if;
  reset role;

  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  set local role authenticated;
  -- Match the membership columns sent by a workspace save: omit user_id
  -- from both INSERT and conflict UPDATE so accepted account bindings survive.
  insert into public.workspace_memberships (workspace_id, email, role, status)
  values (workspace, member_email, 'Owner', 'active')
  on conflict (workspace_id, email) do update set role = excluded.role, status = excluded.status;
  if (select user_id from public.workspace_memberships where workspace_id = workspace and email = member_email) is distinct from member_id then raise exception 'Workspace save detached member account'; end if;
  delete from public.workspace_memberships where workspace_id = workspace and user_id = member_id;
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Owner cannot remove member'; end if;
  reset role;
  perform set_config('request.jwt.claim.sub', member_id::text, true);
  set local role authenticated;
  if exists (select 1 from public.workspaces where id = workspace) then raise exception 'Removed member retained access'; end if;
  reset role;
  if has_function_privilege('anon', 'public.xbar_accept_workspace_invitation(uuid,text)', 'execute') then raise exception 'Anonymous invitation RPC exposed'; end if;
end;
$check$;
rollback;
select 'PASS: authenticated creation/read/write, tenant isolation, no self-enrollment/promotion, atomic assigned-role invitation, unconfirmed/revoked/replay refusal, member removal; all fixtures rolled back' as result;
