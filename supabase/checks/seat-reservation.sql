-- Administrative connection only; every user, workspace, membership and
-- invitation is rolled back. Exercises the real seat trigger and the real
-- invitation-acceptance RPC under the invitee's own identity.
--
-- What this proves (audit F05, migration 20261002090000): a pending invitation
-- RESERVES a seat, and accepting it consumes that reservation instead of
-- counting it a second time.
--   * Professional allows 5 seats. Four active members and one reserved
--     invitation fill it; accepting the reserved invitation succeeds.
--   * Accepting it again changes nothing and still fits.
--   * A sixth, unreserved membership is refused, and so is a new invitation.
begin;
do $check$
declare
  owner_id uuid := gen_random_uuid();
  invitee_id uuid := gen_random_uuid();
  workspace uuid := gen_random_uuid();
  member_ids uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  invitee_email text;
  accepted jsonb;
  active_count integer;
  member uuid;
begin
  invitee_email := invitee_id::text || '@example.invalid';

  insert into auth.users (id, email, email_confirmed_at)
  select id, id::text || '@example.invalid', now()
  from unnest(array[owner_id, invitee_id] || member_ids) as id;

  insert into public.workspaces (id, owner_user_id, workspace_key) values (workspace, owner_id, workspace::text);
  insert into public.workspace_profiles (workspace_id) values (workspace);
  insert into public.workspace_subscription_profiles (workspace_id, tier, billing_state)
  values (workspace, 'Professional', 'Active');

  foreach member in array member_ids loop
    insert into public.workspace_memberships (workspace_id, user_id, email, role, status)
    values (workspace, member, member::text || '@example.invalid', 'Ranch Manager', 'active');
  end loop;

  -- The fifth seat, reserved.
  insert into public.workspace_invitations (workspace_id, invitation_id, email, role, status)
  values (workspace, 'invite-fifth', invitee_email, 'Medical Lead', 'pending');

  -- An unreserved invitation cannot take a sixth seat.
  begin
    insert into public.workspace_invitations (workspace_id, invitation_id, email, role, status)
    values (workspace, 'invite-sixth', 'sixth@example.invalid', 'Medical Lead', 'pending');
    raise exception 'A sixth seat was reserved on a five-seat plan';
  exception when raise_exception then
    if sqlerrm <> 'Seat limit reached for this workspace.' then raise; end if;
  end;

  -- The invitee accepts the reserved seat.
  perform set_config('request.jwt.claim.sub', invitee_id::text, true);
  set local role authenticated;
  accepted := public.xbar_accept_workspace_invitation(workspace, 'invite-fifth');
  reset role;
  if accepted is null then raise exception 'The reserved invitation could not be accepted'; end if;

  select count(*) into active_count from public.workspace_memberships
  where workspace_id = workspace and status = 'active';
  if active_count <> 5 then raise exception 'Expected 5 active seats, found %', active_count; end if;

  -- A retry is a no-op, not a second seat or a failure.
  set local role authenticated;
  accepted := public.xbar_accept_workspace_invitation(workspace, 'invite-fifth');
  reset role;
  if accepted is not null then raise exception 'An accepted invitation was accepted again'; end if;

  -- An unreserved sixth membership is refused.
  begin
    insert into public.workspace_memberships (workspace_id, user_id, email, role, status)
    values (workspace, owner_id, 'sixth-member@example.invalid', 'Medical Lead', 'active');
    raise exception 'A sixth active membership fit on a five-seat plan';
  exception when raise_exception then
    if sqlerrm <> 'Seat limit reached for this workspace.' then raise; end if;
  end;
end;
$check$;
rollback;
select 'PASS: a reserved seat is accepted exactly once and consumed, not counted twice; a sixth unreserved seat or invitation is refused; all fixtures rolled back' as result;
