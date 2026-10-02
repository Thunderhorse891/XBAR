-- Seat reservations are consumed on acceptance, not counted twice (audit F05).
--
-- A pending invitation reserves a seat: inviting checks active members plus
-- pending invitations plus one. Accepting it inserted the active membership
-- while that same invitation was still pending, and the membership check
-- counted active members + ALL pending invitations + 1 -- the reservation and
-- the seat it was reserving. A Professional ranch (5 seats) with four members
-- and one reserved invitation evaluated 4 + 1 + 1 > 5 and refused the invited
-- fifth person. Reproduced against production, rolled back.
--
-- The membership check now leaves out the pending invitation for the
-- member's own email -- the reservation being taken up. Every other pending
-- invitation still counts, so an unreserved sixth seat is still refused.
--
-- Seat checks are also serialized per workspace with a transaction-scoped
-- advisory lock, so concurrent acceptances and invitations cannot each pass
-- by counting the other as absent.
--
-- CREATE OR REPLACE only: the triggers that call this function are unchanged,
-- and no row is read differently except the reservation being consumed.
-- Proven by supabase/checks/seat-reservation.sql.

create or replace function public.xbar_enforce_workspace_seat_limits()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  limits record;
  active_members integer;
  pending_invites integer;
  active_owners integer;
  pending_owner_invites integer;
  target_workspace_id uuid;
begin
  target_workspace_id := coalesce(new.workspace_id, old.workspace_id);
  -- One seat check at a time per workspace. Without it two acceptances, or an
  -- acceptance and an invite, each count the other as not yet there and both
  -- pass -- overfilling the plan.
  perform pg_advisory_xact_lock(hashtextextended('xbar-seats:' || target_workspace_id::text, 0));
  select * into limits from public.xbar_subscription_limits(target_workspace_id);

  if TG_TABLE_NAME = 'workspace_invitations' then
    if lower(coalesce(new.status, 'pending')) = 'pending' then
      select count(*) into active_members
      from public.workspace_memberships
      where workspace_id = target_workspace_id
        and status = 'active';

      select count(*) into pending_invites
      from public.workspace_invitations
      where workspace_id = target_workspace_id
        and status = 'pending'
        and invitation_id <> coalesce(new.invitation_id, '');

      if active_members + pending_invites + 1 > limits.seat_limit then
        raise exception 'Seat limit reached for this workspace.';
      end if;

      if new.role = 'Owner' then
        select count(*) into active_owners
        from public.workspace_memberships
        where workspace_id = target_workspace_id
          and status = 'active'
          and role = 'Owner';

        select count(*) into pending_owner_invites
        from public.workspace_invitations
        where workspace_id = target_workspace_id
          and status = 'pending'
          and role = 'Owner'
          and invitation_id <> coalesce(new.invitation_id, '');

        if limits.shared_access_seat_limit <= 0 or active_owners + pending_owner_invites + 1 > limits.shared_access_seat_limit then
          raise exception 'Shared access seat limit reached for this workspace.';
        end if;
      end if;
    end if;
  elsif TG_TABLE_NAME = 'workspace_memberships' then
    if lower(coalesce(new.status, 'active')) = 'active' then
      select count(*) into active_members
      from public.workspace_memberships
      where workspace_id = target_workspace_id
        and status = 'active'
        and email <> coalesce(new.email, '');

      -- The pending invitation for THIS email is the seat this membership
      -- takes. Counting it as well charged the accepted seat twice, so the
      -- last reserved seat on a plan could never be accepted (audit F05).
      select count(*) into pending_invites
      from public.workspace_invitations
      where workspace_id = target_workspace_id
        and status = 'pending'
        and lower(btrim(email)) <> lower(btrim(coalesce(new.email, '')));

      if active_members + pending_invites + 1 > limits.seat_limit then
        raise exception 'Seat limit reached for this workspace.';
      end if;

      if new.role = 'Owner' then
        select count(*) into active_owners
        from public.workspace_memberships
        where workspace_id = target_workspace_id
          and status = 'active'
          and role = 'Owner'
          and email <> coalesce(new.email, '');

        select count(*) into pending_owner_invites
        from public.workspace_invitations
        where workspace_id = target_workspace_id
          and status = 'pending'
          and role = 'Owner'
          and lower(btrim(email)) <> lower(btrim(coalesce(new.email, '')));

        if limits.shared_access_seat_limit <= 0 or active_owners + pending_owner_invites + 1 > limits.shared_access_seat_limit then
          raise exception 'Shared access seat limit reached for this workspace.';
        end if;
      end if;
    end if;
  end if;

  return new;
end;
$$;
