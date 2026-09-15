-- Applied to xbar-records at ledger version 20260911005818; live rollback
-- checks cover owner/member/outsider permissions and invitation acceptance.
-- Apply after 20260605_harden_workspace_rls.sql. Fixes authenticated workspace
-- reads failing with 42P17 (membership SELECT recursed through itself).
-- Merely removing recursion would expose the old self-join/self-promotion
-- policies, so membership writes now require owner/Admin authorization.
-- Invite acceptance is one atomic, authenticated RPC with server-selected role.
-- Deploy the matching cloudWorkspace.ts client for invitation acceptance.
-- No existing rows are rewritten. Rollback: restore a reviewed policy/RPC
-- snapshot, not the recursive policies or unrestricted self-membership grants.

drop policy if exists "workspaces select active memberships" on public.workspaces;
create policy "workspaces select active memberships" on public.workspaces
for select to authenticated using (public.xbar_has_workspace_access(id));

drop policy if exists "workspace memberships select own or owner" on public.workspace_memberships;
create policy "workspace memberships select own or owner" on public.workspace_memberships
for select to authenticated using (user_id = auth.uid() or public.xbar_has_workspace_access(workspace_id));

drop policy if exists "workspace memberships insert own or owner" on public.workspace_memberships;
create policy "workspace memberships insert own or owner" on public.workspace_memberships
for insert to authenticated with check (public.xbar_can_manage_workspace(workspace_id));

drop policy if exists "workspace memberships update own or owner" on public.workspace_memberships;
create policy "workspace memberships update own or owner" on public.workspace_memberships
for update to authenticated using (public.xbar_can_manage_workspace(workspace_id))
with check (public.xbar_can_manage_workspace(workspace_id));

drop policy if exists "workspace memberships delete owner or admin" on public.workspace_memberships;
create policy "workspace memberships delete owner or admin" on public.workspace_memberships
for delete to authenticated using (public.xbar_can_manage_workspace(workspace_id));

drop policy if exists "workspace invitations select own or workspace access" on public.workspace_invitations;
create policy "workspace invitations select own or workspace access" on public.workspace_invitations
for select to authenticated using (
  (nullif(lower(btrim(email)), '') = nullif(lower(btrim(auth.jwt() ->> 'email')), ''))
  or public.xbar_has_workspace_access(workspace_id)
);

drop policy if exists "workspace invitations insert owner or admin" on public.workspace_invitations;
create policy "workspace invitations insert owner or admin" on public.workspace_invitations
for insert to authenticated with check (public.xbar_can_manage_workspace(workspace_id));

drop policy if exists "workspace invitations update owner admin or invitee" on public.workspace_invitations;
create policy "workspace invitations update owner admin or invitee" on public.workspace_invitations
for update to authenticated using (public.xbar_can_manage_workspace(workspace_id))
with check (public.xbar_can_manage_workspace(workspace_id));

drop policy if exists "workspace invitations delete owner or admin" on public.workspace_invitations;
create policy "workspace invitations delete owner or admin" on public.workspace_invitations
for delete to authenticated using (public.xbar_can_manage_workspace(workspace_id));

create or replace function public.xbar_accept_workspace_invitation(p_workspace_id uuid, p_invitation_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_id uuid := auth.uid();
  caller_email text;
  invitation public.workspace_invitations%rowtype;
  accepted_at timestamptz := now();
begin
  -- Consult current server identity, not editable metadata or client arguments.
  select lower(btrim(email)) into caller_email from auth.users
  where id = caller_id and email_confirmed_at is not null;
  if caller_id is null or coalesce(caller_email, '') = '' then return null; end if;

  select * into invitation from public.workspace_invitations
  where workspace_id = p_workspace_id and invitation_id = p_invitation_id
    and status = 'pending' and lower(btrim(email)) = caller_email
  for update;
  if not found then return null; end if;

  insert into public.workspace_memberships
    (workspace_id, user_id, email, display_name, role, status, payload, updated_at)
  values
    (invitation.workspace_id, caller_id, caller_email, caller_email,
     invitation.role, 'active', jsonb_build_object(
       'id', 'member-' || caller_email, 'email', caller_email,
       'role', invitation.role, 'status', 'Active', 'joinedAt', accepted_at, 'source', 'Invite'
     ), accepted_at)
  on conflict (workspace_id, email) do update set
    user_id = excluded.user_id, role = excluded.role, status = excluded.status,
    payload = excluded.payload, updated_at = excluded.updated_at
  where workspace_memberships.user_id is null or workspace_memberships.user_id = caller_id;
  if not found then return null; end if;

  update public.workspace_invitations set status = 'accepted', updated_at = accepted_at,
    payload = payload || jsonb_build_object('status', 'Accepted', 'acceptedAt', accepted_at)
  where workspace_id = invitation.workspace_id and invitation_id = invitation.invitation_id;
  return jsonb_build_object('workspaceId', invitation.workspace_id, 'role', invitation.role);
end;
$$;

revoke all on function public.xbar_accept_workspace_invitation(uuid, text) from public, anon;
grant execute on function public.xbar_accept_workspace_invitation(uuid, text) to authenticated;
