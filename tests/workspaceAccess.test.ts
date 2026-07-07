import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countReservedSharedAccessSeats,
  countReservedWorkspaceSeats,
  hasBuyerShareAccess,
  validateWorkspaceInvitation,
} from '../src/lib/workspaceAccess.js';
import type { SharedListingRecord, WorkspaceInvitationRecord, WorkspaceMemberRecord } from '../src/types/xbar.js';

const members: WorkspaceMemberRecord[] = [
  {
    id: 'member-admin',
    email: 'admin@xbar.test',
    role: 'Admin',
    status: 'Active',
    joinedAt: '2026-03-30T12:00:00.000Z',
    source: 'Owner',
  },
  {
    id: 'member-owner',
    email: 'owner@xbar.test',
    role: 'Owner',
    status: 'Active',
    joinedAt: '2026-03-30T12:00:00.000Z',
    source: 'Invite',
  },
];

const invites: WorkspaceInvitationRecord[] = [
  {
    id: 'invite-owner',
    email: 'buyer@xbar.test',
    role: 'Owner',
    status: 'Pending',
    invitedBy: 'Admin',
    invitedAt: '2026-03-30T12:00:00.000Z',
  },
];

test('counts reserved seats including active members and pending invites', () => {
  assert.equal(countReservedWorkspaceSeats(members, invites), 3);
  assert.equal(countReservedSharedAccessSeats(members, invites), 2);
});

test('blocks duplicate or over-capacity invites', () => {
  assert.equal(
    validateWorkspaceInvitation({
      email: 'OWNER@xbar.test',
      role: 'Owner',
      members,
      invitations: invites,
      seatLimit: 6,
      sharedAccessSeatLimit: 4,
    }),
    'owner@xbar.test already has workspace access.',
  );

  assert.equal(
    validateWorkspaceInvitation({
      email: 'new-owner@xbar.test',
      role: 'Owner',
      members,
      invitations: invites,
      seatLimit: 6,
      sharedAccessSeatLimit: 2,
    }),
    'Shared access seat limit reached for the current plan.',
  );
});

test('buyer access honors private tokens and public links', () => {
  const listing: SharedListingRecord = {
    id: 'listing-1',
    horseId: 'horse-1',
    sharePath: '/profiles/horse-1',
    accessMode: 'Private Token',
    shareToken: 'secret',
    tokenIssuedAt: '2026-03-30',
    state: 'Live',
    channels: ['Direct Link'],
    createdAt: '2026-03-30',
    updatedAt: '2026-03-30',
  };

  assert.equal(hasBuyerShareAccess(listing, ''), false);
  assert.equal(hasBuyerShareAccess(listing, 'secret'), true);
  assert.equal(hasBuyerShareAccess({ ...listing, accessMode: 'Public Link' }, ''), true);
});
