import type { SharedListingRecord, UserRole, WorkspaceInvitationRecord, WorkspaceMemberRecord } from '../types/xbar.js';

type InviteValidationParams = {
  email: string;
  role: UserRole;
  members: WorkspaceMemberRecord[];
  invitations: WorkspaceInvitationRecord[];
  seatLimit: number;
  sharedAccessSeatLimit: number;
};

export function normalizeWorkspaceEmail(value: string) {
  return value.trim().toLowerCase();
}

export function countReservedWorkspaceSeats(
  members: WorkspaceMemberRecord[],
  invitations: WorkspaceInvitationRecord[],
) {
  return (
    members.filter((member) => member.status === 'Active').length +
    invitations.filter((invite) => invite.status === 'Pending').length
  );
}

/*
 * Shared-access seats count Horse Owner / Client accounts, not buyers.
 *
 * The distinction matters because the two are easy to conflate and the plans
 * used to be sold as "buyer seats". A buyer opens a share link with no account
 * at all (see hasBuyerShareAccess below), so buyers never consume a seat and no
 * limit applies to how many of them view a listing. What this caps is the
 * number of people given the read-only 'Owner' role — the ranch's clients — who
 * do hold real accounts in the workspace.
 *
 * The same rule is enforced independently by the
 * xbar_enforce_workspace_seat_limits database trigger, which is the actual
 * gate; this is the client-side check that produces a useful message first.
 */
export function countReservedSharedAccessSeats(
  members: WorkspaceMemberRecord[],
  invitations: WorkspaceInvitationRecord[],
) {
  const activeOwnerMembers = members.filter((member) => member.status === 'Active' && member.role === 'Owner').length;
  const pendingOwnerInvites = invitations.filter(
    (invite) => invite.status === 'Pending' && invite.role === 'Owner',
  ).length;
  return activeOwnerMembers + pendingOwnerInvites;
}

export function validateWorkspaceInvitation(params: InviteValidationParams) {
  const normalizedEmail = normalizeWorkspaceEmail(params.email);
  if (!normalizedEmail) {
    return 'Invite email is required.';
  }

  const existingMember = params.members.find(
    (member) => normalizeWorkspaceEmail(member.email) === normalizedEmail && member.status === 'Active',
  );
  if (existingMember) {
    return `${normalizedEmail} already has workspace access.`;
  }

  const existingInvite = params.invitations.find(
    (invite) => normalizeWorkspaceEmail(invite.email) === normalizedEmail && invite.status === 'Pending',
  );
  if (existingInvite) {
    return `${normalizedEmail} already has a pending invite.`;
  }

  if (countReservedWorkspaceSeats(params.members, params.invitations) >= params.seatLimit) {
    return 'Seat limit reached for the current plan.';
  }

  if (
    params.role === 'Owner' &&
    (params.sharedAccessSeatLimit <= 0 ||
      countReservedSharedAccessSeats(params.members, params.invitations) >= params.sharedAccessSeatLimit)
  ) {
    return 'Shared access seat limit reached for the current plan.';
  }

  return null;
}

export function hasBuyerShareAccess(listing: SharedListingRecord | undefined, shareToken: string) {
  if (!listing || listing.state === 'Archived') {
    return false;
  }

  if (listing.accessMode === 'Public Link') {
    return true;
  }

  return Boolean(shareToken) && shareToken === listing.shareToken;
}
