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
