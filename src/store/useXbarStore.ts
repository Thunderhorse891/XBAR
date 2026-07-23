import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  buildDocumentRecord,
  buildSubscriptionForTier,
  createId,
  createShareAccessToken,
  estimateStorageGb,
  guessGalleryKind,
  nowStamp,
  todayStamp,
} from '@/lib/xbarRuntime';
import { normalizeWorkspaceEmail, validateWorkspaceInvitation } from '@/lib/workspaceAccess';
import { apiConfig, isSupabaseConfigured } from '@/lib/platformConfig';
import { useCloudStore } from '@/store/useCloudStore';
import { hasRoleCapability } from '@/lib/permissions';
import { buildSaleHold } from '@/lib/saleTrustEngine';
import { featureGate } from '@/lib/commercialEngine';
import { buildOfferDecision } from '@/lib/profitIntelligence';
import { scheduleBuyerActivityFollowUp } from '@/lib/salesFollowUp';
import {
  createWorkspaceInvitationInCloud,
  removeWorkspaceMemberFromCloud,
  revokeWorkspaceInvitationInCloud,
  updateSharedListingChannelsInCloud,
  uploadDocumentAssetToCloud,
  uploadMediaAssetToCloud,
  upsertSharedListingInCloud,
} from '@/lib/cloudWorkspace';
import { workspaceStateStorage } from '@/lib/workspaceStorage';
import {
  canMarkTransferClear,
  computeOwnershipConfidence,
  createAuditEvent,
  createOwnershipRecord,
  normalizeOwnershipRecord,
  validateExpenseReceiptInput,
  summarizeBatch,
  validateAssetPatch,
  validateHorseNoteInput,
  validateLeadInput,
  validateLocationPatch,
  validateNewHorseInput,
} from '@/store/xbarStoreLogic';
import type {
  BreedingEconomics,
  HorseNote,
  IntakeBatch,
  OwnershipStake,
  RoleCapability,
  SalesLead,
  WorkspaceInvitationRecord,
} from '@/types/xbar';
import type { BuyerRoomEvent, DocumentRecord, SalePacketBuild } from '@/types/xbar';
import type { XbarStore } from '@/store/xbarStoreTypes';
import {
  WORKSPACE_SCHEMA_VERSION,
  buildHorseInputFromDocuments,
  createEmptyWorkspaceState,
  createExpenseReceiptRecord,
  createHorseFromDocuments,
  createHorseRecord,
  createInitialWorkspaceMember,
  createSharedListingRecord,
  createTimelineEvent,
  initialState,
  isWorkspaceSetup,
  looksLikeLegacyDemoWorkspace,
  normalizeUsage,
  promoteDocument,
  requireRoleCapability,
  restorePersistedState,
  restoreWorkspaceProfile,
  selectPersistedState,
  syncDerivedValues,
} from '@/store/xbarStoreHelpers';

export const useXbarStore = create<XbarStore>()(
  persist(
    (set, get) => ({
      ...initialState,
      setCurrentRole: (role) => set({ currentRole: role }),
      initializeWorkspace: (profile) => {
        const businessName = profile.businessName?.trim() ?? '';
        const ranchName = profile.ranchName?.trim() ?? '';
        if (!businessName || !ranchName) {
          return { ok: false, message: 'Business name and ranch name are required to create the workspace.' };
        }

        const current = get();
        const nextProfile = restoreWorkspaceProfile({
          ...current.workspaceProfile,
          ...profile,
          businessName,
          ranchName,
          setupCompleteAt: current.workspaceProfile.setupCompleteAt || nowStamp(),
        });
        const resetLegacyDemo = looksLikeLegacyDemoWorkspace(selectPersistedState(current));
        const seedState = resetLegacyDemo ? createEmptyWorkspaceState() : selectPersistedState(current);
        const workspaceMembers = seedState.workspaceMembers.length
          ? seedState.workspaceMembers
          : [createInitialWorkspaceMember(nextProfile)];
        const derived = syncDerivedValues({
          horses: seedState.horses,
          salesLeads: seedState.salesLeads,
          sharedListings: seedState.sharedListings,
          sharedAccess: seedState.sharedAccess,
          workspaceMembers,
          workspaceInvitations: seedState.workspaceInvitations,
          subscription: seedState.subscription,
        });

        set({
          ...seedState,
          subscription: derived.subscription,
          sharedAccess: derived.sharedAccess,
          horses: derived.horses,
          workspaceMembers,
          workspaceProfile: nextProfile,
        });

        return {
          ok: true,
          message: resetLegacyDemo
            ? 'Workspace created and legacy starter records were cleared.'
            : 'Workspace created.',
        };
      },
      updateWorkspaceProfile: (patch) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSettings');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const current = get();
        const nextProfile = restoreWorkspaceProfile({ ...current.workspaceProfile, ...patch });
        const workspaceMembers = current.workspaceMembers.map((member, index) =>
          index === 0 && member.source === 'Owner'
            ? {
                ...member,
                email: normalizeWorkspaceEmail(nextProfile.operationsEmail) || member.email,
              }
            : member,
        );
        const derived = syncDerivedValues({
          horses: current.horses,
          salesLeads: current.salesLeads,
          sharedListings: current.sharedListings,
          sharedAccess: current.sharedAccess,
          workspaceMembers,
          workspaceInvitations: current.workspaceInvitations,
          subscription: current.subscription,
        });
        set({
          workspaceProfile: nextProfile,
          workspaceMembers,
          subscription: derived.subscription,
          sharedAccess: derived.sharedAccess,
          horses: derived.horses,
        });
        return { ok: true, message: 'Workspace profile updated.' };
      },
      applySubscriptionTier: (tier, options = {}) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageBilling');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const state = get();
        if (state.subscription.tier === tier && state.subscription.monthlyRate > 0) {
          return { ok: false, message: `${tier} is already the active plan.` };
        }

        const subscription = buildSubscriptionForTier(state.subscription, tier, {
          billingState: options.billingState ?? 'Manual Billing',
        });
        const derived = syncDerivedValues({
          horses: state.horses,
          salesLeads: state.salesLeads,
          sharedListings: state.sharedListings,
          sharedAccess: state.sharedAccess,
          workspaceMembers: state.workspaceMembers,
          workspaceInvitations: state.workspaceInvitations,
          subscription,
        });
        set({
          subscription: derived.subscription,
          sharedAccess: derived.sharedAccess,
          horses: derived.horses,
        });
        return { ok: true, message: `${tier} is now active for this workspace. Limits and features updated.` };
      },
      toggleSharedListing: async (horseId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSharedAccess');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const state = get();
        if (!state.horses.some((horse) => horse.id === horseId)) {
          return { ok: false, message: 'Horse record not found for shared access.' };
        }

        const existingListing = state.sharedListings.find(
          (listing) => listing.horseId === horseId && listing.state !== 'Archived',
        );
        const isActive = Boolean(existingListing);
        const cloudListing = existingListing
          ? {
              ...existingListing,
              state: 'Archived' as const,
              updatedAt: todayStamp(),
            }
          : createSharedListingRecord(horseId, {
              state: 'Draft',
            });

        if (isSupabaseConfigured()) {
          const cloudResult = await upsertSharedListingInCloud(cloudListing);
          if (!cloudResult.ok) {
            return { ok: false, message: cloudResult.message };
          }
        }

        set((state) => {
          const nextSharedListings = existingListing
            ? state.sharedListings.map((listing) =>
                listing.horseId === horseId
                  ? {
                      ...cloudListing,
                    }
                  : listing,
              )
            : [cloudListing, ...state.sharedListings];

          const horses = state.horses.map((horse) =>
            horse.id === horseId
              ? {
                  ...horse,
                  sale: {
                    ...horse.sale,
                    watchlistCount: Math.max(0, horse.sale.watchlistCount + (existingListing ? -1 : 1)),
                  },
                }
              : horse,
          );

          return {
            sharedListings: nextSharedListings,
            ...syncDerivedValues({
              horses,
              salesLeads: state.salesLeads,
              sharedListings: nextSharedListings,
              sharedAccess: state.sharedAccess,
              workspaceMembers: state.workspaceMembers,
              workspaceInvitations: state.workspaceInvitations,
              subscription: state.subscription,
            }),
          };
        });
        return {
          ok: true,
          message: isActive ? 'Horse removed from shared access.' : 'Horse added to shared access.',
          id: horseId,
        };
      },
      confirmSharedListingRelease: async (horseId, confirmedBy) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSharedAccess');
        if (deniedMessage) return { ok: false, message: deniedMessage };
        const state = get();
        const horse = state.horses.find((item) => item.id === horseId);
        const listing = state.sharedListings.find((item) => item.horseId === horseId && item.state !== 'Archived');
        if (!horse || !listing) return { ok: false, message: 'Create the buyer listing before confirming release.' };
        const hold = buildSaleHold(
          horse,
          state.documents,
          state.ownershipRecords.find((record) => record.horseId === horseId),
        );
        if (hold.held) return { ok: false, message: `Release blocked: ${hold.reasons[0]}` };
        if (!confirmedBy.trim())
          return { ok: false, message: 'Authorized seller name is required for legal release confirmation.' };

        const nextListing = {
          ...listing,
          releaseConfirmedAt: nowStamp(),
          releaseConfirmedBy: confirmedBy.trim(),
          releaseConfirmationVersion: 'buyer-packet-release-v1',
          updatedAt: todayStamp(),
        };
        if (isSupabaseConfigured()) {
          const cloudResult = await upsertSharedListingInCloud(nextListing);
          if (!cloudResult.ok) return cloudResult;
        }
        const auditEvent = createAuditEvent({
          actor: get().currentRole,
          action: 'status-change',
          entityType: 'shared-access',
          entityId: listing.id,
          summary: `${confirmedBy.trim()} confirmed legal release for the buyer packet.`,
          context: { horseId, releaseVersion: 'buyer-packet-release-v1' },
        });
        set((current) => ({
          sharedListings: current.sharedListings.map((item) => (item.id === listing.id ? nextListing : item)),
          auditEvents: [auditEvent, ...current.auditEvents].slice(0, 500),
        }));
        return { ok: true, message: `${confirmedBy.trim()} confirmed the buyer packet release.`, id: horseId };
      },
      recordSharedChannel: async (horseId, channel) => {
        const state = get();
        const horse = state.horses.find((item) => item.id === horseId);
        const listing = state.sharedListings.find((item) => item.horseId === horseId && item.state !== 'Archived');
        if (!horse || !listing) return { ok: false, message: 'Create the buyer listing before sharing.' };
        const hold = buildSaleHold(
          horse,
          state.documents,
          state.ownershipRecords.find((record) => record.horseId === horseId),
        );
        if (hold.held) return { ok: false, message: `Buyer packet is on hold: ${hold.reasons[0]}` };
        if (!listing.releaseConfirmedAt || !listing.releaseConfirmedBy) {
          return {
            ok: false,
            message: 'Authorized seller release confirmation is required before sharing the buyer packet.',
          };
        }
        if (isSupabaseConfigured()) {
          const cloudResult = await updateSharedListingChannelsInCloud({ horseId, channel });
          if (!cloudResult.ok) {
            return {
              ok: false,
              message: `Buyer packet share was not recorded in the cloud audit trail: ${cloudResult.message}`,
            };
          }
        }

        const auditEvent = createAuditEvent({
          actor: state.currentRole,
          action: 'shared',
          entityType: 'shared-access',
          entityId: listing.id,
          summary: `Buyer packet shared through ${channel}.`,
          context: { horseId, channel },
        });
        set((current) => ({
          sharedListings: current.sharedListings.map((item) =>
            item.horseId === horseId && item.state !== 'Archived'
              ? {
                  ...item,
                  state: item.state === 'Draft' ? 'Live' : item.state,
                  channels: item.channels.includes(channel) ? item.channels : [...item.channels, channel],
                  lastSharedAt: todayStamp(),
                  updatedAt: todayStamp(),
                }
              : item,
          ),
          auditEvents: [auditEvent, ...current.auditEvents].slice(0, 500),
        }));
        return { ok: true, message: 'Buyer packet share recorded.', id: horseId };
      },
      rotateSharedListingToken: async (horseId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSharedAccess');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const state = get();
        const existingListing = state.sharedListings.find(
          (listing) => listing.horseId === horseId && listing.state !== 'Archived',
        );
        if (!existingListing) {
          return { ok: false, message: 'Shared listing not found for this horse.' };
        }

        const nextListing = {
          ...existingListing,
          shareToken: createShareAccessToken(),
          tokenIssuedAt: todayStamp(),
          updatedAt: todayStamp(),
        };

        if (isSupabaseConfigured()) {
          const cloudResult = await upsertSharedListingInCloud(nextListing);
          if (!cloudResult.ok) {
            return { ok: false, message: cloudResult.message };
          }
        }

        set((state) => ({
          sharedListings: state.sharedListings.map((listing) =>
            listing.horseId === horseId && listing.state !== 'Archived'
              ? {
                  ...nextListing,
                }
              : listing,
          ),
        }));

        return { ok: true, message: 'Share token rotated.', id: horseId };
      },
      updateSharedListingAccessMode: async (horseId, accessMode) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSharedAccess');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const state = get();
        const existingListing = state.sharedListings.find(
          (listing) => listing.horseId === horseId && listing.state !== 'Archived',
        );
        if (!existingListing) {
          return { ok: false, message: 'Shared listing not found for this horse.' };
        }

        const nextListing = {
          ...existingListing,
          accessMode,
          updatedAt: todayStamp(),
        };

        if (isSupabaseConfigured()) {
          const cloudResult = await upsertSharedListingInCloud(nextListing);
          if (!cloudResult.ok) {
            return { ok: false, message: cloudResult.message };
          }
        }

        set((state) => ({
          sharedListings: state.sharedListings.map((listing) =>
            listing.horseId === horseId && listing.state !== 'Archived'
              ? {
                  ...nextListing,
                }
              : listing,
          ),
        }));

        return {
          ok: true,
          message: accessMode === 'Public Link' ? 'Sale link is now public.' : 'Sale link now requires a token.',
          id: horseId,
        };
      },
      inviteWorkspaceMember: async (email, role) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSettings');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const state = get();
        const validationError = validateWorkspaceInvitation({
          email,
          role,
          members: state.workspaceMembers,
          invitations: state.workspaceInvitations,
          seatLimit: state.subscription.usage.seatLimit,
          sharedAccessSeatLimit: state.subscription.usage.sharedAccessSeatLimit,
        });

        if (validationError) {
          return { ok: false, message: validationError };
        }

        const invite: WorkspaceInvitationRecord = {
          id: createId('invite'),
          email: normalizeWorkspaceEmail(email),
          role,
          status: 'Pending',
          invitedBy:
            state.workspaceProfile.ranchManagerName.trim() ||
            state.workspaceProfile.businessName.trim() ||
            'Workspace Admin',
          invitedAt: nowStamp(),
        };

        if (isSupabaseConfigured()) {
          const cloudResult = await createWorkspaceInvitationInCloud(invite);
          if (!cloudResult.ok) {
            return { ok: false, message: cloudResult.message };
          }

          // Fire invite email via API (best-effort — don't block on failure)
          try {
            const session = useCloudStore.getState().session;
            const accessToken = session?.access_token ?? '';
            const apiBase = apiConfig.baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
            await fetch(`${apiBase}/api/invite`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
              body: JSON.stringify({
                email: invite.email,
                role: invite.role,
                workspaceId: useCloudStore.getState().workspaceId,
                invitationId: invite.id,
              }),
            });
          } catch {
            /* non-critical */
          }
        }

        const workspaceInvitations = [invite, ...state.workspaceInvitations];
        const derived = syncDerivedValues({
          horses: state.horses,
          salesLeads: state.salesLeads,
          sharedListings: state.sharedListings,
          sharedAccess: state.sharedAccess,
          workspaceMembers: state.workspaceMembers,
          workspaceInvitations,
          subscription: state.subscription,
        });

        set({
          workspaceInvitations,
          subscription: derived.subscription,
          sharedAccess: derived.sharedAccess,
          horses: derived.horses,
        });

        return { ok: true, message: `Invite reserved for ${invite.email}.`, id: invite.id };
      },
      revokeWorkspaceInvitation: async (invitationId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSettings');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const state = get();
        if (!state.workspaceInvitations.some((invite) => invite.id === invitationId && invite.status === 'Pending')) {
          return { ok: false, message: 'Pending invite not found.' };
        }

        if (isSupabaseConfigured()) {
          const cloudResult = await revokeWorkspaceInvitationInCloud(invitationId);
          if (!cloudResult.ok) {
            return { ok: false, message: cloudResult.message };
          }
        }

        const workspaceInvitations = state.workspaceInvitations.map((invite) =>
          invite.id === invitationId
            ? {
                ...invite,
                status: 'Revoked' as const,
                revokedAt: nowStamp(),
              }
            : invite,
        );
        const derived = syncDerivedValues({
          horses: state.horses,
          salesLeads: state.salesLeads,
          sharedListings: state.sharedListings,
          sharedAccess: state.sharedAccess,
          workspaceMembers: state.workspaceMembers,
          workspaceInvitations,
          subscription: state.subscription,
        });

        set({
          workspaceInvitations,
          subscription: derived.subscription,
          sharedAccess: derived.sharedAccess,
          horses: derived.horses,
        });

        return { ok: true, message: 'Invite revoked.', id: invitationId };
      },
      activateWorkspaceInvitation: (invitationId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSettings');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const state = get();
        const invite = state.workspaceInvitations.find((item) => item.id === invitationId && item.status === 'Pending');
        if (!invite) {
          return { ok: false, message: 'Pending invite not found.' };
        }

        const workspaceInvitations = state.workspaceInvitations.map((item) =>
          item.id === invitationId
            ? {
                ...item,
                status: 'Accepted' as const,
                acceptedAt: nowStamp(),
              }
            : item,
        );
        const workspaceMembers = [
          {
            id: createId('member'),
            email: invite.email,
            role: invite.role,
            status: 'Active' as const,
            invitedAt: invite.invitedAt,
            joinedAt: nowStamp(),
            source: 'Invite' as const,
          },
          ...state.workspaceMembers.filter((member) => normalizeWorkspaceEmail(member.email) !== invite.email),
        ];
        const derived = syncDerivedValues({
          horses: state.horses,
          salesLeads: state.salesLeads,
          sharedListings: state.sharedListings,
          sharedAccess: state.sharedAccess,
          workspaceMembers,
          workspaceInvitations,
          subscription: state.subscription,
        });

        set({
          workspaceMembers,
          workspaceInvitations,
          subscription: derived.subscription,
          sharedAccess: derived.sharedAccess,
          horses: derived.horses,
        });

        return { ok: true, message: `${invite.email} is now active.`, id: invitationId };
      },
      removeWorkspaceMember: async (memberId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSettings');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const state = get();
        const member = state.workspaceMembers.find((item) => item.id === memberId);
        if (!member) {
          return { ok: false, message: 'Workspace member not found.' };
        }

        const activeAdmins = state.workspaceMembers.filter((item) => item.status === 'Active' && item.role === 'Admin');
        if (member.role === 'Admin' && member.status === 'Active' && activeAdmins.length <= 1) {
          return { ok: false, message: 'Keep at least one active admin on the workspace.' };
        }

        if (isSupabaseConfigured()) {
          const cloudResult = await removeWorkspaceMemberFromCloud(member);
          if (!cloudResult.ok) {
            return { ok: false, message: cloudResult.message };
          }
        }

        const workspaceMembers = state.workspaceMembers.filter((item) => item.id !== memberId);
        const derived = syncDerivedValues({
          horses: state.horses,
          salesLeads: state.salesLeads,
          sharedListings: state.sharedListings,
          sharedAccess: state.sharedAccess,
          workspaceMembers,
          workspaceInvitations: state.workspaceInvitations,
          subscription: state.subscription,
        });

        set({
          workspaceMembers,
          subscription: derived.subscription,
          sharedAccess: derived.sharedAccess,
          horses: derived.horses,
        });

        return { ok: true, message: `${member.email} removed from the workspace.`, id: memberId };
      },
      addHorse: (input) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'createHorse');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const validationError = validateNewHorseInput(input);
        if (validationError) {
          return { ok: false, message: validationError };
        }

        const horse = createHorseRecord(input, get().workspaceProfile);
        const ownershipRecord = createOwnershipRecord(horse);
        set((state) => ({
          horses: [horse, ...state.horses],
          ownershipRecords: [ownershipRecord, ...state.ownershipRecords],
          subscription: {
            ...state.subscription,
            usage: { ...state.subscription.usage, horsesUsed: state.horses.length + 1 },
          },
        }));
        return { ok: true, message: `${horse.name} is now live in the horse portfolio.`, id: horse.id };
      },
      createDocumentIntake: async ({ files, horseId, source, uploadedBy, label, createHorseFromBatch }) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'uploadDocuments');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const fileList = files.filter(Boolean);
        if (!fileList.length) {
          return { ok: false, message: 'Select at least one file to upload.' };
        }

        if (!uploadedBy.trim()) {
          return { ok: false, message: 'Uploaded by is required before uploading.' };
        }

        const state = get();
        const storageIncrease = estimateStorageGb(fileList);
        if (state.subscription.usage.storageUsedGb + storageIncrease > state.subscription.usage.storageLimitGb) {
          return {
            ok: false,
            message: 'Storage limit reached for the current plan. Upgrade before adding more files.',
          };
        }

        // Surface live progress: on-device OCR of a large batch can take a
        // while, so the UI shows "Reading N of M" instead of a silent spinner.
        const totalFiles = fileList.length;
        let processedFiles = 0;
        set(() => ({ documentIntakeProgress: { processed: 0, total: totalFiles, phase: 'Reading documents' } }));

        try {
          const selectedHorse = state.horses.find((horse) => horse.id === horseId);
          const batchId = createId('batch');
          let documents: DocumentRecord[] = await Promise.all(
            fileList.map(async (file) => {
              let uploadedAsset: Awaited<ReturnType<typeof uploadDocumentAssetToCloud>> = null;
              try {
                uploadedAsset = await uploadDocumentAssetToCloud({
                  file,
                  horseId: selectedHorse?.id ?? horseId,
                });
              } catch (error) {
                console.error('Cloud document upload failed; storing file locally instead.', error);
              }
              const document = await buildDocumentRecord({
                file,
                uploadedBy,
                source,
                selectedHorse,
                horses: get().horses,
                existingDocuments: get().documents,
              });
              const localFileUrl = undefined;
              processedFiles += 1;
              set(() => ({
                documentIntakeProgress: { processed: processedFiles, total: totalFiles, phase: 'Reading documents' },
              }));
              return {
                ...document,
                batchId,
                fileName: file.name,
                mimeType: file.type || undefined,
                fileSizeBytes: file.size,
                fileUrl: localFileUrl,
                storagePath: uploadedAsset?.storagePath,
              };
            }),
          );
          let createdHorseBundles =
            !selectedHorse && createHorseFromBatch
              ? Array.from(
                  documents
                    .filter((document) => !document.horseId)
                    .reduce((groups, document) => {
                      const key =
                        document.entities.registrationNumber?.trim() ||
                        document.entities.horseName?.trim() ||
                        document.title.trim().toUpperCase();
                      if (!key) {
                        return groups;
                      }
                      const group = groups.get(key) ?? [];
                      group.push(document);
                      groups.set(key, group);
                      return groups;
                    }, new Map<string, DocumentRecord[]>()),
                )
                  .map(([, groupedDocuments]) => {
                    const horseInput = buildHorseInputFromDocuments(groupedDocuments, state.workspaceProfile);
                    if (!horseInput) {
                      return null;
                    }

                    const duplicateHorse = state.horses.some(
                      (horse) =>
                        horse.name === horseInput.name ||
                        (horseInput.registrationNumber && horse.registrationNumber === horseInput.registrationNumber),
                    );
                    if (duplicateHorse) {
                      return null;
                    }

                    return createHorseFromDocuments(groupedDocuments, state.workspaceProfile);
                  })
                  .filter((bundle): bundle is NonNullable<typeof bundle> => Boolean(bundle))
              : [];
          const availableHorseSlots = Math.max(0, state.subscription.usage.horseLimit - state.horses.length);
          const omittedHorseCount = Math.max(0, createdHorseBundles.length - availableHorseSlots);
          createdHorseBundles = createdHorseBundles.slice(0, availableHorseSlots);

          if (createdHorseBundles.length) {
            const createdDocumentMap = new Map(
              createdHorseBundles.flatMap((bundle) =>
                bundle.documents.map((document) => [document.id, document] as const),
              ),
            );
            documents = documents.map((document) => createdDocumentMap.get(document.id) ?? document);
          }
          const localDocumentCount = documents.filter((document) => !document.storagePath).length;
          const createdHorses = createdHorseBundles.map((bundle) => bundle.horse);
          const createdOwnershipRecords = createdHorseBundles.map((bundle) => bundle.ownershipRecord);

          const batch: IntakeBatch = {
            id: batchId,
            label: label?.trim() || `${source} upload`,
            receivedAt: nowStamp(),
            source,
            fileCount: documents.length,
            processedCount: documents.length,
            needsReviewCount: documents.filter((document) => document.state === 'Needs Review').length,
            matchedCount: documents.filter((document) => document.state === 'Matched' || document.state === 'Ready')
              .length,
            state: documents.some((document) => document.state === 'Needs Review') ? 'Reviewing' : 'Completed',
          };

          set((current) => {
            const allDocuments = [...documents, ...current.documents];
            const nextHorses = current.horses.map((horse) => {
              const matchedDocuments = documents.filter(
                (document) =>
                  document.horseId === horse.id && (document.state === 'Matched' || document.state === 'Ready'),
              );
              return matchedDocuments.reduce(promoteDocument, horse);
            });

            return {
              documents: allDocuments,
              intakeBatches: [batch, ...current.intakeBatches],
              horses: [...createdHorses, ...nextHorses],
              ownershipRecords: [...createdOwnershipRecords, ...current.ownershipRecords],
              subscription: {
                ...current.subscription,
                usage: {
                  ...current.subscription.usage,
                  documentsProcessed: allDocuments.filter((document) => document.state !== 'Archived').length,
                  horsesUsed: createdHorses.length + nextHorses.length,
                  storageUsedGb: normalizeUsage(current.subscription.usage.storageUsedGb + storageIncrease),
                },
              },
            };
          });

          return {
            ok: true,
            message: `${documents.length} file${documents.length === 1 ? '' : 's'} entered the document queue.${createdHorses.length ? ` ${createdHorses.length} new horse record${createdHorses.length === 1 ? ' was' : 's were'} created from the upload batch.` : ''}${omittedHorseCount ? ` ${omittedHorseCount} additional horse candidate${omittedHorseCount === 1 ? ' was' : 's were'} left for review because the horse limit was reached.` : ''}${localDocumentCount ? ` ${localDocumentCount} kept as metadata only because cloud file storage is not available.` : ''}`,
            id: batch.id,
            createdHorseIds: createdHorses.map((horse) => horse.id),
          };
        } catch (error) {
          console.error('Document upload failed', error);
          return { ok: false, message: 'Document upload failed. Check the selected files and try again.' };
        } finally {
          // Always clear progress so the UI never sticks on a stale count.
          set(() => ({ documentIntakeProgress: null }));
        }
      },
      reviewDocument: (documentId, horseId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'reviewDocuments');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const state = get();
        const document = state.documents.find((item) => item.id === documentId);
        if (!document) {
          return { ok: false, message: 'Document not found.' };
        }

        const nextHorseId = horseId ?? document.horseId;
        if (!nextHorseId) {
          return { ok: false, message: 'Choose a horse before approving this document.' };
        }

        const matchedHorse = state.horses.find((horse) => horse.id === nextHorseId);
        if (!matchedHorse) {
          return { ok: false, message: 'Selected horse record was not found.' };
        }

        const nextDocument: DocumentRecord = {
          ...document,
          horseId: nextHorseId,
          state: 'Ready',
          confidence: Math.max(document.confidence, 0.92),
          duplicateRisk: document.duplicateRisk === 'Possible Duplicate' ? 'Review' : document.duplicateRisk,
          entities: {
            ...document.entities,
            horseName: matchedHorse.name,
            ownerName: document.entities.ownerName ?? matchedHorse.owner,
            registrationNumber: document.entities.registrationNumber ?? matchedHorse.registrationNumber,
          },
          summary: `${document.title} is approved and attached to ${matchedHorse.name}.`,
        };

        set((current) => {
          const nextDocuments = current.documents.map((item) => (item.id === documentId ? nextDocument : item));
          const nextHorses = current.horses.map((horse) =>
            horse.id === matchedHorse.id ? promoteDocument(horse, nextDocument) : horse,
          );
          const nextBatches = current.intakeBatches.map((batch) => summarizeBatch(batch, nextDocuments));

          return {
            documents: nextDocuments,
            horses: nextHorses,
            intakeBatches: nextBatches,
          };
        });

        return { ok: true, message: `${matchedHorse.name} now has this document attached.`, id: matchedHorse.id };
      },
      createHorseFromDocument: (documentId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'createHorse');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const state = get();
        const document = state.documents.find((item) => item.id === documentId);
        if (!document) {
          return { ok: false, message: 'Document not found.' };
        }
        if (document.horseId) {
          return { ok: false, message: 'This document is already linked to a horse.' };
        }

        // Don't create a duplicate: if a horse matching this paper's registration
        // number or name already exists, attach the document to it instead.
        const norm = (value: string | undefined) => (value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
        const proposed = buildHorseInputFromDocuments([document], state.workspaceProfile);
        const extractedReg = norm(document.entities.registrationNumber);
        const proposedName = norm(proposed?.name);
        const existingHorse = state.horses.find((horse) => {
          const regMatch = Boolean(extractedReg) && norm(horse.registrationNumber) === extractedReg;
          const nameMatch = Boolean(proposedName) && norm(horse.name) === proposedName;
          return regMatch || nameMatch;
        });
        if (existingHorse) {
          const attached = get().reviewDocument(documentId, existingHorse.id);
          return attached.ok
            ? {
                ok: true,
                message: `${existingHorse.name} is already on file — attached this document to it instead of creating a duplicate.`,
                id: existingHorse.id,
              }
            : attached;
        }

        const availableHorseSlots = Math.max(0, state.subscription.usage.horseLimit - state.horses.length);
        if (availableHorseSlots < 1) {
          return { ok: false, message: 'Your plan’s horse limit is reached. Upgrade to add more horses.' };
        }

        const bundle = createHorseFromDocuments([document], state.workspaceProfile);
        if (!bundle) {
          return {
            ok: false,
            message:
              'Not enough was read from this document to create a horse. Add the horse manually, then attach it.',
          };
        }

        const readyDocument = bundle.documents.find((item) => item.id === documentId) ?? document;
        set((current) => {
          const nextDocuments = current.documents.map((item) => (item.id === documentId ? readyDocument : item));
          const nextBatches = current.intakeBatches.map((batch) => summarizeBatch(batch, nextDocuments));
          return {
            horses: [bundle.horse, ...current.horses],
            documents: nextDocuments,
            ownershipRecords: [bundle.ownershipRecord, ...current.ownershipRecords],
            intakeBatches: nextBatches,
            subscription: {
              ...current.subscription,
              usage: {
                ...current.subscription.usage,
                horsesUsed: current.horses.length + 1,
                documentsProcessed: nextDocuments.filter((item) => item.state !== 'Archived').length,
              },
            },
          };
        });

        return { ok: true, message: `${bundle.horse.name} was created from ${document.title}.`, id: bundle.horse.id };
      },
      discardDocument: (documentId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'reviewDocuments');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const document = get().documents.find((item) => item.id === documentId);
        if (!document) {
          return { ok: false, message: 'Document not found.' };
        }

        set((current) => {
          const nextDocuments = current.documents.map((item) =>
            item.id === documentId
              ? {
                  ...item,
                  state: 'Archived' as const,
                  summary: `${item.title} was discarded from the review queue.`,
                }
              : item,
          );

          return {
            documents: nextDocuments,
            intakeBatches: current.intakeBatches.map((batch) => summarizeBatch(batch, nextDocuments)),
            subscription: {
              ...current.subscription,
              usage: {
                ...current.subscription.usage,
                documentsProcessed: nextDocuments.filter((item) => item.state !== 'Archived').length,
              },
            },
          };
        });

        return { ok: true, message: `${document.title} was removed from active review.`, id: document.id };
      },
      uploadHorseMedia: async ({ horseId, files, kind, makePrimary }) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'uploadMedia');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const fileList = files.filter(Boolean);
        if (!fileList.length) {
          return { ok: false, message: 'Select at least one image to upload.' };
        }

        const state = get();
        if (!state.horses.some((horse) => horse.id === horseId)) {
          return { ok: false, message: 'Horse record not found for this media upload.' };
        }

        const storageIncrease = estimateStorageGb(fileList);
        if (state.subscription.usage.storageUsedGb + storageIncrease > state.subscription.usage.storageLimitGb) {
          return { ok: false, message: 'Storage limit reached for this plan. Upgrade before uploading more media.' };
        }

        try {
          const assets = await Promise.all(
            fileList.map(async (file) => {
              let uploadedAsset: Awaited<ReturnType<typeof uploadMediaAssetToCloud>> = null;
              try {
                uploadedAsset = await uploadMediaAssetToCloud({ file, horseId });
              } catch (error) {
                console.error('Cloud media upload failed; storing media locally instead.', error);
              }
              return {
                id: createId('media'),
                label: file.name.replace(/\.[^.]+$/, ''),
                kind: kind ?? guessGalleryKind(file.name),
                url: uploadedAsset?.publicUrl ?? '',
                storagePath: uploadedAsset?.storagePath,
                status: 'Approved' as const,
              };
            }),
          );
          const localAssetCount = assets.filter((asset) => !asset.storagePath).length;

          set((current) => ({
            horses: current.horses.map((horse) =>
              horse.id === horseId
                ? {
                    ...horse,
                    profileImage: makePrimary ? (assets[0]?.url ?? horse.profileImage) : horse.profileImage,
                    gallery: [...assets, ...horse.gallery],
                    readiness: {
                      ...horse.readiness,
                      score: Math.min(100, horse.readiness.score + 5),
                      packetStatus:
                        horse.readiness.packetStatus === 'Needs Photos' ? 'Ready' : horse.readiness.packetStatus,
                      blockers: horse.readiness.blockers.filter((blocker) => blocker !== 'Hero image missing'),
                    },
                    sale: {
                      ...horse.sale,
                      socialReady: true,
                    },
                    activity: [
                      {
                        id: createId('activity'),
                        date: todayStamp(),
                        title: 'Media uploaded',
                        summary: `${assets.length} media asset${assets.length === 1 ? '' : 's'} added to the horse profile.`,
                        owner: 'Media Desk',
                        category: 'Sales' as const,
                      },
                      ...horse.activity,
                    ],
                  }
                : horse,
            ),
            subscription: {
              ...current.subscription,
              usage: {
                ...current.subscription.usage,
                storageUsedGb: normalizeUsage(current.subscription.usage.storageUsedGb + storageIncrease),
              },
            },
          }));

          return {
            ok: true,
            message: `${assets.length} media asset${assets.length === 1 ? '' : 's'} uploaded.${localAssetCount ? ` ${localAssetCount} kept as metadata only because cloud media storage is not available.` : ''}`,
            id: horseId,
          };
        } catch (error) {
          console.error('Media upload failed', error);
          return { ok: false, message: 'Media upload failed. Check the selected files and try again.' };
        }
      },
      addExpenseReceipt: async (input) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageAssets');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const validationError = validateExpenseReceiptInput(input);
        if (validationError) {
          return { ok: false, message: validationError };
        }

        const state = get();
        if (input.horseId && !state.horses.some((horse) => horse.id === input.horseId)) {
          return { ok: false, message: 'Horse record not found for this receipt.' };
        }

        const fileList = input.file ? [input.file] : [];
        const storageIncrease = estimateStorageGb(fileList);
        if (
          fileList.length &&
          state.subscription.usage.storageUsedGb + storageIncrease > state.subscription.usage.storageLimitGb
        ) {
          return {
            ok: false,
            message: 'Storage limit reached for the current plan. Remove files or upgrade before adding more receipts.',
          };
        }

        try {
          let uploadedAsset: Awaited<ReturnType<typeof uploadDocumentAssetToCloud>> = null;
          if (input.file) {
            try {
              uploadedAsset = await uploadDocumentAssetToCloud({
                file: input.file,
                horseId: input.horseId,
              });
            } catch (error) {
              console.error('Cloud receipt upload failed; storing receipt locally instead.', error);
            }
          }

          const localFileUrl = undefined;
          const receipt = createExpenseReceiptRecord(input, {
            fileUrl: localFileUrl,
            storagePath: uploadedAsset?.storagePath,
            fileName: input.file?.name,
            mimeType: input.file?.type || undefined,
            fileSizeBytes: input.file?.size,
          });

          set((current) => ({
            expenseReceipts: [receipt, ...current.expenseReceipts],
            horses: current.horses.map((horse) =>
              horse.id === receipt.horseId
                ? {
                    ...horse,
                    activity: [
                      {
                        id: createId('activity'),
                        date: receipt.receiptDate,
                        title: `${receipt.category} receipt logged`,
                        summary: `${receipt.vendor} receipt added for ${receipt.category.toLowerCase()} spend.`,
                        owner: receipt.uploadedBy,
                        category: 'Operations' as const,
                      },
                      ...horse.activity,
                    ],
                  }
                : horse,
            ),
            subscription: {
              ...current.subscription,
              usage: {
                ...current.subscription.usage,
                storageUsedGb: normalizeUsage(current.subscription.usage.storageUsedGb + storageIncrease),
              },
            },
          }));

          return {
            ok: true,
            message: `${receipt.category} receipt logged.${input.file && !uploadedAsset?.storagePath ? ' Receipt file metadata was saved, but the file itself requires cloud storage.' : ''}`,
            id: receipt.id,
          };
        } catch (error) {
          console.error('Expense receipt upload failed', error);
          return { ok: false, message: 'Receipt upload failed. Check the fields and try again.' };
        }
      },
      createSalesLead: ({ horseId, name, channel, shareReady }) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSales');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const validationError = validateLeadInput({ horseId, name, channel, shareReady });
        if (validationError) {
          return { ok: false, message: validationError };
        }

        if (!get().horses.some((horse) => horse.id === horseId)) {
          return { ok: false, message: 'Horse record not found for this lead.' };
        }

        const lead: SalesLead = {
          id: createId('lead'),
          name: name.trim(),
          channel,
          horseId,
          stage: 'New',
          lastTouch: todayStamp(),
          nextFollowUp: '',
          notes: '',
          offerStatus: 'Draft',
          depositStatus: 'Not Requested',
          savedListing: false,
          shareReady: Boolean(shareReady),
        };

        set((current) => {
          const salesLeads = [lead, ...current.salesLeads];
          const horses = current.horses.map((horse) =>
            horse.id === horseId
              ? {
                  ...horse,
                  sale: {
                    ...horse.sale,
                    inquiryCount: horse.sale.inquiryCount + 1,
                  },
                  activity: [
                    {
                      id: createId('activity'),
                      date: todayStamp(),
                      title: 'Sale inquiry captured',
                      summary: `${lead.name} entered the pipeline from ${lead.channel}.`,
                      owner: 'Ranch Staff',
                      category: 'Sales' as const,
                    },
                    ...horse.activity,
                  ],
                }
              : horse,
          );

          return {
            salesLeads,
            ...syncDerivedValues({
              horses,
              salesLeads,
              sharedListings: current.sharedListings,
              sharedAccess: current.sharedAccess,
              workspaceMembers: current.workspaceMembers,
              workspaceInvitations: current.workspaceInvitations,
              subscription: current.subscription,
            }),
          };
        });

        return { ok: true, message: `${lead.name} is now in the buyer pipeline.`, id: lead.id };
      },
      updateSalesLead: (leadId, patch) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSales');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }
        if (
          patch.offerAmount !== undefined ||
          patch.counterOfferAmount !== undefined ||
          patch.offerStatus !== undefined ||
          patch.depositAmount !== undefined ||
          patch.depositStatus !== undefined
        ) {
          const planBlocked = featureGate(get().subscription, 'buyerDealRoom');
          if (planBlocked) return { ok: false, message: planBlocked };
        }

        const lead = get().salesLeads.find((item) => item.id === leadId);
        if (!lead) {
          return { ok: false, message: 'Lead not found.' };
        }

        const nextOfferStatus = patch.offerStatus ?? lead.offerStatus;
        if (nextOfferStatus && ['Accepted', 'Deposit Due', 'Deposit Paid'].includes(nextOfferStatus)) {
          const horse = get().horses.find((item) => item.id === lead.horseId);
          if (!horse) return { ok: false, message: 'Horse record not found for this offer.' };
          const decision = buildOfferDecision(
            horse,
            get().expenseReceipts,
            patch.offerAmount ?? lead.offerAmount ?? 0,
            patch.counterOfferAmount ?? lead.counterOfferAmount ?? 0,
          );
          if (decision.acceptanceBlocked) {
            return { ok: false, message: `${decision.label}. ${decision.recommendation}` };
          }
        }

        set((current) => {
          const salesLeads = current.salesLeads.map((item) =>
            item.id === leadId
              ? {
                  ...item,
                  ...patch,
                  lastTouch: patch.lastTouch ?? item.lastTouch,
                  offerUpdatedAt:
                    patch.offerAmount !== undefined ||
                    patch.counterOfferAmount !== undefined ||
                    patch.offerStatus !== undefined ||
                    patch.depositAmount !== undefined ||
                    patch.depositStatus !== undefined
                      ? nowStamp()
                      : item.offerUpdatedAt,
                }
              : item,
          );

          return {
            salesLeads,
            ...syncDerivedValues({
              horses: current.horses,
              salesLeads,
              sharedListings: current.sharedListings,
              sharedAccess: current.sharedAccess,
              workspaceMembers: current.workspaceMembers,
              workspaceInvitations: current.workspaceInvitations,
              subscription: current.subscription,
            }),
          };
        });

        return { ok: true, message: `${lead.name} updated.`, id: leadId };
      },
      addRanchAsset: (asset) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageAssets');
        if (deniedMessage) return { ok: false, message: deniedMessage };
        if (!asset.name.trim()) return { ok: false, message: 'Asset name is required.' };
        const id = crypto.randomUUID();
        set((state) => ({
          ranchAssets: [
            ...state.ranchAssets,
            {
              id,
              name: asset.name.trim(),
              category: asset.category,
              status: 'Available' as const,
              condition: 'Excellent' as const,
              assignedTo: '',
              location: asset.location.trim(),
              nextService: '',
              notes: '',
            },
          ],
        }));
        return { ok: true, message: 'Asset added.', id };
      },

      updateAsset: (assetId, patch) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageAssets');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        if (!get().ranchAssets.some((asset) => asset.id === assetId)) {
          return { ok: false, message: 'Asset record not found.' };
        }

        const validationError = validateAssetPatch(patch);
        if (validationError) {
          return { ok: false, message: validationError };
        }

        set((state) => ({
          ranchAssets: state.ranchAssets.map((asset) => (asset.id === assetId ? { ...asset, ...patch } : asset)),
        }));
        return { ok: true, message: 'Asset record updated.', id: assetId };
      },
      deleteAsset: (assetId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageAssets');
        if (deniedMessage) return { ok: false, message: deniedMessage };
        const state = get();
        const asset = state.ranchAssets.find((a) => a.id === assetId);
        if (!asset) return { ok: false, message: 'Asset not found.' };
        const auditEvent = createAuditEvent({
          actor: state.currentRole,
          action: 'deleted',
          entityType: 'asset',
          entityId: assetId,
          summary: `Equipment asset "${asset.name}" deleted`,
        });
        set({
          ranchAssets: state.ranchAssets.filter((a) => a.id !== assetId),
          auditEvents: [auditEvent, ...state.auditEvents].slice(0, 500),
        });
        return { ok: true, message: `${asset.name} removed from equipment.` };
      },
      addHorseNote: (horseId, note) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'editHorse');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const validationError = validateHorseNoteInput(note);
        if (validationError) {
          return { ok: false, message: validationError };
        }

        if (!get().horses.some((horse) => horse.id === horseId)) {
          return { ok: false, message: 'Horse record not found for this note.' };
        }

        const nextNote: HorseNote = {
          id: createId('note'),
          title: note.title.trim(),
          body: note.body.trim(),
          author: note.author.trim(),
          tone: note.tone,
          createdAt: todayStamp(),
        };

        set((state) => ({
          horses: state.horses.map((horse) =>
            horse.id === horseId
              ? {
                  ...horse,
                  notes: [nextNote, ...horse.notes],
                  activity: [
                    {
                      id: createId('activity'),
                      date: todayStamp(),
                      title: note.title,
                      summary: note.body,
                      owner: note.author,
                      category: 'Operations' as const,
                    },
                    ...horse.activity,
                  ],
                }
              : horse,
          ),
        }));

        return { ok: true, message: 'Horse note saved.', id: nextNote.id };
      },
      addMedicalEvent: (horseId, event) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageMedical');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        if (
          !event.title.trim() ||
          !event.body.trim() ||
          !event.author.trim() ||
          !event.date.trim() ||
          !event.type.trim()
        ) {
          return { ok: false, message: 'Medical events need a type, title, note, owner, and date.' };
        }

        if (!get().horses.some((horse) => horse.id === horseId)) {
          return { ok: false, message: 'Horse record not found for this medical event.' };
        }

        const shouldOpenMedicalReview = event.type === 'Injury';
        const nextEvent = createTimelineEvent({
          title: event.title,
          summary: event.body,
          owner: event.author,
          date: event.date,
          category: 'Medical',
          status: event.type,
          severity: event.type === 'Injury' ? 'high' : event.type === 'Treatment' ? 'medium' : undefined,
        });

        set((state) => ({
          horses: state.horses.map((horse) =>
            horse.id === horseId
              ? {
                  ...horse,
                  status: shouldOpenMedicalReview ? 'Medical Review' : horse.status,
                  lastVetVisit: event.type === 'Vet visit' ? event.date : horse.lastVetVisit,
                  medicalNotes: shouldOpenMedicalReview ? event.body : horse.medicalNotes,
                  medicalTimeline: [nextEvent, ...horse.medicalTimeline],
                  activity: [nextEvent, ...horse.activity],
                }
              : horse,
          ),
        }));

        return { ok: true, message: 'Medical event added.', id: nextEvent.id };
      },
      addBreedingEvent: (horseId, event) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageBreeding');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        if (!event.title.trim() || !event.body.trim() || !event.author.trim() || !event.date.trim()) {
          return { ok: false, message: 'Breeding events need a title, note, owner, and date.' };
        }

        if (!get().horses.some((horse) => horse.id === horseId)) {
          return { ok: false, message: 'Horse record not found for this breeding event.' };
        }

        const nextEvent = createTimelineEvent({
          title: event.title,
          summary: event.body,
          owner: event.author,
          date: event.date,
          category: 'Breeding',
        });

        set((state) => ({
          horses: state.horses.map((horse) =>
            horse.id === horseId
              ? {
                  ...horse,
                  breedingTimeline: [nextEvent, ...horse.breedingTimeline],
                  activity: [nextEvent, ...horse.activity],
                }
              : horse,
          ),
        }));

        return { ok: true, message: 'Breeding event added.', id: nextEvent.id };
      },
      updateBreedingEconomics: (horseId, economics) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageBreeding');
        if (deniedMessage) return { ok: false, message: deniedMessage };
        const planBlocked = featureGate(get().subscription, 'breedingRevenue');
        if (planBlocked) return { ok: false, message: planBlocked };
        if (!get().horses.some((horse) => horse.id === horseId))
          return { ok: false, message: 'Horse record not found.' };
        const normalized = Object.fromEntries(
          Object.entries(economics).map(([key, value]) => [key, Math.max(0, Number(value) || 0)]),
        ) as unknown as BreedingEconomics;
        set((state) => ({
          horses: state.horses.map((horse) =>
            horse.id === horseId ? { ...horse, breedingEconomics: normalized } : horse,
          ),
        }));
        return { ok: true, message: 'Breeding revenue profile updated.', id: horseId };
      },
      deleteBreedingEvent: (horseId, eventId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageBreeding');
        if (deniedMessage) return { ok: false, message: deniedMessage };
        const horse = get().horses.find((h) => h.id === horseId);
        if (!horse) return { ok: false, message: 'Horse not found.' };
        const removedBreeding = horse.breedingTimeline.find((e) => e.id === eventId);
        const breedingAudit = createAuditEvent({
          actor: get().currentRole,
          action: 'deleted',
          entityType: 'breeding',
          entityId: eventId,
          summary: `Breeding record "${removedBreeding?.title ?? 'entry'}" deleted from ${horse.name}`,
          context: { horseId },
        });
        set({
          horses: get().horses.map((h) =>
            h.id === horseId ? { ...h, breedingTimeline: h.breedingTimeline.filter((e) => e.id !== eventId) } : h,
          ),
          auditEvents: [breedingAudit, ...get().auditEvents].slice(0, 500),
        });
        return { ok: true, message: 'Breeding event removed.' };
      },
      updateHorseLocation: (horseId, patch) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'editHorse');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const validationError = validateLocationPatch(patch);
        if (validationError) {
          return { ok: false, message: validationError };
        }

        if (!get().horses.some((horse) => horse.id === horseId)) {
          return { ok: false, message: 'Horse record not found for this location update.' };
        }

        set((state) => ({
          horses: state.horses.map((horse) =>
            horse.id === horseId
              ? {
                  ...horse,
                  location: {
                    ...horse.location,
                    ...patch,
                  },
                  activity: [
                    {
                      id: createId('activity'),
                      date: todayStamp(),
                      title: 'Location updated',
                      summary: `Horse location updated to ${patch.barn ?? horse.location.barn} / ${patch.pasture ?? horse.location.pasture}.`,
                      owner: 'Ranch Staff',
                      category: 'Operations' as const,
                    },
                    ...horse.activity,
                  ],
                }
              : horse,
          ),
        }));

        return { ok: true, message: 'Horse location updated.', id: horseId };
      },
      updateHorse: (horseId, patch) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'editHorse');
        if (deniedMessage) return { ok: false, message: deniedMessage };
        if (!get().horses.some((h) => h.id === horseId)) return { ok: false, message: 'Horse not found.' };
        set((state) => ({
          horses: state.horses.map((h) => {
            if (h.id !== horseId) return h;
            const registrationNumber = patch.registrationNumber?.trim() ?? h.registrationNumber;
            const aqhaNumber = patch.aqhaNumber?.trim() ?? h.aqhaNumber;
            return {
              ...h,
              name: patch.name?.trim() ?? h.name,
              barnName: patch.barnName?.trim() ?? h.barnName,
              breed: patch.breed?.trim() ?? h.breed,
              color: patch.color?.trim() ?? h.color,
              sex: patch.sex ?? h.sex,
              foaledOn: patch.foaledOn?.trim() ?? h.foaledOn,
              registrationNumber,
              registry: patch.registry?.trim() ?? h.registry,
              aqhaNumber,
              // Adding a registration number promotes the record to "registered".
              registered: Boolean(registrationNumber || aqhaNumber),
              owner: patch.owner?.trim() ?? h.owner,
              ownerEntity: patch.ownerEntity?.trim() ?? h.ownerEntity,
              microchipId: patch.microchipId?.trim() ?? h.microchipId,
              markings: patch.markings?.trim() ?? h.markings,
              segment: patch.segment ?? h.segment,
              status: patch.status ?? h.status,
              costBasis: patch.costBasis !== undefined ? Math.max(0, Number(patch.costBasis) || 0) : h.costBasis,
              sale: patch.askPrice !== undefined ? { ...h.sale, askPrice: patch.askPrice } : h.sale,
              bloodline:
                patch.sire !== undefined || patch.dam !== undefined
                  ? {
                      ...h.bloodline,
                      sire: patch.sire?.trim() ?? h.bloodline.sire,
                      dam: patch.dam?.trim() ?? h.bloodline.dam,
                    }
                  : h.bloodline,
            };
          }),
        }));
        return { ok: true, message: 'Horse record updated.', id: horseId };
      },
      deleteHorse: (horseId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'editHorse');
        if (deniedMessage) return { ok: false, message: deniedMessage };
        const removedHorse = get().horses.find((h) => h.id === horseId);
        set((state) => {
          const horses = state.horses.filter((h) => h.id !== horseId);
          return {
            horses,
            subscription: { ...state.subscription, usage: { ...state.subscription.usage, horsesUsed: horses.length } },
            auditEvents: [
              createAuditEvent({
                actor: state.currentRole,
                action: 'deleted',
                entityType: 'horse',
                entityId: horseId,
                summary: `Horse record "${removedHorse?.name ?? horseId}" deleted with its documents and timelines`,
              }),
              ...state.auditEvents,
            ].slice(0, 500),
          };
        });
        return { ok: true, message: 'Horse removed from records.', id: horseId };
      },
      updateMedicalEvent: (horseId, eventId, patch) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'editHorse');
        if (deniedMessage) return { ok: false, message: deniedMessage };
        set((state) => ({
          horses: state.horses.map((h) =>
            h.id === horseId
              ? {
                  ...h,
                  medicalTimeline: h.medicalTimeline.map((ev) => (ev.id === eventId ? { ...ev, ...patch } : ev)),
                  activity: h.activity.map((ev) => (ev.id === eventId ? { ...ev, ...patch } : ev)),
                }
              : h,
          ),
        }));
        return { ok: true, message: 'Medical event updated.', id: eventId };
      },
      deleteMedicalEvent: (horseId, eventId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'editHorse');
        if (deniedMessage) return { ok: false, message: deniedMessage };
        const medicalHorse = get().horses.find((h) => h.id === horseId);
        const removedMedical = medicalHorse?.medicalTimeline.find((ev) => ev.id === eventId);
        set((state) => ({
          horses: state.horses.map((h) =>
            h.id === horseId
              ? {
                  ...h,
                  medicalTimeline: h.medicalTimeline.filter((ev) => ev.id !== eventId),
                  activity: h.activity.filter((ev) => ev.id !== eventId || ev.category !== 'Medical'),
                }
              : h,
          ),
          auditEvents: [
            createAuditEvent({
              actor: state.currentRole,
              action: 'deleted',
              entityType: 'medical',
              entityId: eventId,
              summary: `Medical record "${removedMedical?.title ?? 'entry'}" deleted from ${medicalHorse?.name ?? horseId}`,
              context: { horseId },
            }),
            ...state.auditEvents,
          ].slice(0, 500),
        }));
        return { ok: true, message: 'Medical event removed.', id: eventId };
      },
      updateOwnershipRecord: (recordId, patch) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageOwnership');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const record = get().ownershipRecords.find((item) => item.id === recordId);
        if (!record) {
          return { ok: false, message: 'Ownership record not found.' };
        }

        set((state) => ({
          ownershipRecords: state.ownershipRecords.map((item) =>
            item.id === recordId
              ? {
                  ...item,
                  ...patch,
                }
              : item,
          ),
          horses: state.horses.map((horse) =>
            horse.id === record.horseId
              ? {
                  ...horse,
                  owner: patch.legalOwner ?? horse.owner,
                  ownership: horse.ownership.map((stake, index) =>
                    index === 0
                      ? {
                          ...stake,
                          name: patch.legalOwner ?? stake.name,
                        }
                      : stake,
                  ),
                }
              : horse,
          ),
        }));

        return { ok: true, message: 'Ownership record updated.', id: recordId };
      },
      addOwnershipAuditEntry: (recordId, entry) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageOwnership');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const trimmed = entry.trim();
        if (!trimmed) {
          return { ok: false, message: 'Enter an audit note before saving.' };
        }

        if (!get().ownershipRecords.some((record) => record.id === recordId)) {
          return { ok: false, message: 'Ownership record not found.' };
        }

        set((state) => ({
          ownershipRecords: state.ownershipRecords.map((record) =>
            record.id === recordId
              ? {
                  ...record,
                  auditTrail: [`${todayStamp()} ${trimmed}`, ...record.auditTrail],
                }
              : record,
          ),
        }));

        return { ok: true, message: 'Audit note added.', id: recordId };
      },
      recordAuditEvent: (input) => {
        const event = createAuditEvent(input);
        set((state) => ({ auditEvents: [event, ...state.auditEvents].slice(0, 500) }));
      },
      linkOwnershipProof: (recordId, requirementId, documentId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageOwnership');
        if (deniedMessage) return { ok: false, message: deniedMessage };

        const record = get().ownershipRecords.find((item) => item.id === recordId);
        if (!record) return { ok: false, message: 'Ownership record not found.' };
        const document = get().documents.find((item) => item.id === documentId);
        if (!document) return { ok: false, message: 'Select an uploaded document to use as proof.' };

        const normalized = normalizeOwnershipRecord(record);
        const requirement = normalized.proofRequirements?.find((item) => item.id === requirementId);
        if (!requirement) return { ok: false, message: 'Proof requirement not found.' };

        const nextRequirements = (normalized.proofRequirements ?? []).map((item) =>
          item.id === requirementId
            ? {
                ...item,
                status: 'linked' as const,
                documentId,
                documentTitle: document.title,
                linkedAt: new Date().toISOString(),
                verifiedAt: undefined,
                verifiedBy: undefined,
              }
            : item,
        );
        const auditEvent = createAuditEvent({
          actor: get().currentRole,
          action: 'linked-proof',
          entityType: 'ownership',
          entityId: recordId,
          summary: `${requirement.label} linked to document "${document.title}"`,
          context: { documentId, horseId: record.horseId },
        });

        set((state) => ({
          ownershipRecords: state.ownershipRecords.map((item) =>
            item.id === recordId
              ? {
                  ...normalized,
                  proofRequirements: nextRequirements,
                  confidence: computeOwnershipConfidence(nextRequirements),
                  auditEvents: [auditEvent, ...(normalized.auditEvents ?? [])],
                  auditTrail: [`${todayStamp()} ${auditEvent.summary}`, ...item.auditTrail],
                }
              : item,
          ),
          auditEvents: [auditEvent, ...state.auditEvents].slice(0, 500),
        }));

        return { ok: true, message: `${requirement.label} linked to ${document.title}.`, id: recordId };
      },
      verifyOwnershipProof: (recordId, requirementId, verifiedBy) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageOwnership');
        if (deniedMessage) return { ok: false, message: deniedMessage };

        const record = get().ownershipRecords.find((item) => item.id === recordId);
        if (!record) return { ok: false, message: 'Ownership record not found.' };

        const normalized = normalizeOwnershipRecord(record);
        const requirement = normalized.proofRequirements?.find((item) => item.id === requirementId);
        if (!requirement) return { ok: false, message: 'Proof requirement not found.' };
        if (requirement.status !== 'linked') {
          return { ok: false, message: 'Link a document before verifying.' };
        }

        const nextRequirements = (normalized.proofRequirements ?? []).map((item) =>
          item.id === requirementId
            ? { ...item, status: 'verified' as const, verifiedAt: new Date().toISOString(), verifiedBy }
            : item,
        );
        const auditEvent = createAuditEvent({
          actor: verifiedBy,
          action: 'verified-proof',
          entityType: 'ownership',
          entityId: recordId,
          summary: `${requirement.label} verified against "${requirement.documentTitle ?? 'linked document'}"`,
          context: { horseId: record.horseId },
        });

        set((state) => ({
          ownershipRecords: state.ownershipRecords.map((item) =>
            item.id === recordId
              ? {
                  ...normalized,
                  proofRequirements: nextRequirements,
                  confidence: computeOwnershipConfidence(nextRequirements),
                  auditEvents: [auditEvent, ...(normalized.auditEvents ?? [])],
                  auditTrail: [`${todayStamp()} ${auditEvent.summary}`, ...item.auditTrail],
                }
              : item,
          ),
          auditEvents: [auditEvent, ...state.auditEvents].slice(0, 500),
        }));

        return { ok: true, message: `${requirement.label} verified.`, id: recordId };
      },
      unlinkOwnershipProof: (recordId, requirementId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageOwnership');
        if (deniedMessage) return { ok: false, message: deniedMessage };

        const record = get().ownershipRecords.find((item) => item.id === recordId);
        if (!record) return { ok: false, message: 'Ownership record not found.' };

        const normalized = normalizeOwnershipRecord(record);
        const requirement = normalized.proofRequirements?.find((item) => item.id === requirementId);
        if (!requirement) return { ok: false, message: 'Proof requirement not found.' };

        const nextRequirements = (normalized.proofRequirements ?? []).map((item) =>
          item.id === requirementId
            ? {
                ...item,
                status: 'missing' as const,
                documentId: undefined,
                documentTitle: undefined,
                linkedAt: undefined,
                verifiedAt: undefined,
                verifiedBy: undefined,
              }
            : item,
        );
        const auditEvent = createAuditEvent({
          actor: get().currentRole,
          action: 'unlinked-proof',
          entityType: 'ownership',
          entityId: recordId,
          summary: `${requirement.label} unlinked — proof must be re-established`,
          context: { horseId: record.horseId },
        });

        set((state) => ({
          ownershipRecords: state.ownershipRecords.map((item) =>
            item.id === recordId
              ? {
                  ...normalized,
                  proofRequirements: nextRequirements,
                  confidence: computeOwnershipConfidence(nextRequirements),
                  auditEvents: [auditEvent, ...(normalized.auditEvents ?? [])],
                  auditTrail: [`${todayStamp()} ${auditEvent.summary}`, ...item.auditTrail],
                }
              : item,
          ),
          auditEvents: [auditEvent, ...state.auditEvents].slice(0, 500),
        }));

        return { ok: true, message: `${requirement.label} unlinked.`, id: recordId };
      },
      setTransferStatus: (recordId, status, actor) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageOwnership');
        if (deniedMessage) return { ok: false, message: deniedMessage };

        const record = get().ownershipRecords.find((item) => item.id === recordId);
        if (!record) return { ok: false, message: 'Ownership record not found.' };

        const normalized = normalizeOwnershipRecord(record);
        if (status === 'Clear') {
          const clearance = canMarkTransferClear(normalized);
          if (!clearance.ok) {
            return {
              ok: false,
              message: `Cannot mark transfer Clear until every proof is verified: ${clearance.blockers.join('; ')}.`,
            };
          }
        }

        const auditEvent = createAuditEvent({
          actor,
          action: 'status-change',
          entityType: 'ownership',
          entityId: recordId,
          summary: `Transfer status changed: ${record.transferStatus} → ${status}`,
          context: { horseId: record.horseId },
        });

        set((state) => ({
          ownershipRecords: state.ownershipRecords.map((item) =>
            item.id === recordId
              ? {
                  ...normalized,
                  transferStatus: status,
                  auditEvents: [auditEvent, ...(normalized.auditEvents ?? [])],
                  auditTrail: [`${todayStamp()} ${auditEvent.summary}`, ...item.auditTrail],
                }
              : item,
          ),
          auditEvents: [auditEvent, ...state.auditEvents].slice(0, 500),
        }));

        return { ok: true, message: `Transfer status set to ${status}.`, id: recordId };
      },
      createSalePacketBuild: (input) => {
        const horse = get().horses.find((item) => item.id === input.horseId);
        if (!horse) {
          return { ok: false, message: 'Horse record not found for this packet.' };
        }

        const slug =
          horse.name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'horse';
        const packet: SalePacketBuild = {
          id: createId('packet'),
          horseId: input.horseId,
          createdAt: new Date().toISOString(),
          createdBy: input.createdBy,
          buyerName: input.buyerName,
          buyerEmail: input.buyerEmail,
          watermark: input.watermark,
          documentIds: input.documentIds,
          includesBillOfSale: input.includesBillOfSale,
          status: 'generated',
          fileName: `sale-packet-${slug}-${todayStamp()}.pdf`,
          downloadUrl: input.downloadUrl,
        };
        const auditEvent = createAuditEvent({
          actor: input.createdBy,
          action: 'generated',
          entityType: 'sale-packet',
          entityId: packet.id,
          summary: `Sale packet generated for ${horse.name} (${input.documentIds.length} documents${input.includesBillOfSale ? ' + Bill of Sale' : ''})`,
          context: { horseId: input.horseId },
        });

        set((state) => ({
          salePacketBuilds: [packet, ...state.salePacketBuilds],
          subscription: {
            ...state.subscription,
            usage: {
              ...state.subscription.usage,
              salePacketsGenerated: state.subscription.usage.salePacketsGenerated + 1,
            },
          },
          auditEvents: [auditEvent, ...state.auditEvents].slice(0, 500),
        }));

        return { ok: true, message: `Sale packet ready for ${horse.name}.`, id: packet.id, packet };
      },
      logBuyerRoomEvent: (input) => {
        const horse = get().horses.find((item) => item.id === input.horseId);
        if (!horse) {
          return { ok: false, message: 'Horse record not found for this buyer event.' };
        }
        const kindLabels: Record<BuyerRoomEvent['kind'], string> = {
          'packet-shared': 'Packet shared with buyer',
          'packet-viewed': 'Buyer viewed packet',
          'packet-downloaded': 'Buyer downloaded packet',
          question: 'Buyer asked a question',
          'call-requested': 'Buyer requested a call',
          'proof-requested': 'Buyer requested proof',
          offer: 'Buyer submitted an offer',
          'seller-response': 'Seller responded',
          'deal-status': 'Deal status updated',
        };
        const event: BuyerRoomEvent = {
          id: createId('buyer-event'),
          horseId: input.horseId,
          packetId: input.packetId,
          kind: input.kind,
          at: new Date().toISOString(),
          actor: input.actor,
          note: input.note,
          amount: input.amount,
          dealStatus: input.dealStatus,
          replyToEventId: input.replyToEventId,
        };
        const auditEvent = createAuditEvent({
          actor: input.actor,
          action: input.kind === 'packet-shared' ? 'shared' : 'updated',
          entityType: 'sale-packet',
          entityId: input.packetId ?? input.horseId,
          summary: `${kindLabels[input.kind]} — ${horse.name}${input.amount ? ` ($${input.amount.toLocaleString()})` : ''}`,
          context: { horseId: input.horseId },
        });
        set((state) => ({
          buyerRoomEvents: [event, ...state.buyerRoomEvents].slice(0, 1000),
          auditEvents: [auditEvent, ...state.auditEvents].slice(0, 500),
        }));
        return { ok: true, message: `${kindLabels[input.kind]} logged for ${horse.name}.`, id: event.id, event };
      },
      mergeBuyerRoomEvents: (events) => {
        const current = get().buyerRoomEvents;
        const merged = [...events, ...current]
          .filter((event, index, list) => list.findIndex((candidate) => candidate.id === event.id) === index)
          .sort((left, right) => Date.parse(right.at) - Date.parse(left.at))
          .slice(0, 1000);
        set({ buyerRoomEvents: merged });
        return {
          ok: true,
          message: events.length
            ? `${events.length} public buyer event${events.length === 1 ? '' : 's'} refreshed.`
            : 'Buyer activity is current.',
        };
      },
      captureBuyerRoomOffer: (eventId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSales');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }
        const planBlocked = featureGate(get().subscription, 'buyerDealRoom');
        if (planBlocked) {
          return { ok: false, message: planBlocked };
        }

        const event = get().buyerRoomEvents.find((item) => item.id === eventId);
        if (!event || event.kind !== 'offer' || !(event.amount && event.amount > 0)) {
          return { ok: false, message: 'Buyer offer event not found.' };
        }

        const normalizedActor = event.actor.trim().toLowerCase();
        let lead = get().salesLeads.find(
          (item) => item.horseId === event.horseId && item.name.trim().toLowerCase() === normalizedActor,
        );
        if (!lead) {
          const created = get().createSalesLead({
            horseId: event.horseId,
            name: event.actor,
            channel: 'Site Inquiry',
            shareReady: true,
          });
          if (!created.ok || !created.id) {
            return created;
          }
          lead = get().salesLeads.find((item) => item.id === created.id);
        }
        if (!lead) {
          return { ok: false, message: 'Buyer lead could not be prepared for this offer.' };
        }

        const offerNote = event.note?.trim() ?? '';
        const notes = [lead.notes?.trim(), offerNote && !lead.notes?.includes(offerNote) ? offerNote : '']
          .filter(Boolean)
          .join('\n\n');
        const updated = get().updateSalesLead(lead.id, {
          stage: 'Offer',
          lastTouch: todayStamp(),
          offerAmount: event.amount,
          offerStatus: 'Submitted',
          shareReady: true,
          notes,
        });
        if (!updated.ok) {
          return updated;
        }

        return {
          ok: true,
          id: lead.id,
          message: `${event.actor}'s ${event.amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} offer is now in the Sales margin workflow.`,
        };
      },
      captureBuyerRoomFollowUp: (eventId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageSales');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }
        const planBlocked = featureGate(get().subscription, 'buyerDealRoom');
        if (planBlocked) {
          return { ok: false, message: planBlocked };
        }

        const event = get().buyerRoomEvents.find((item) => item.id === eventId);
        if (!event || (event.kind !== 'packet-downloaded' && event.kind !== 'call-requested')) {
          return { ok: false, message: 'Buyer follow-up event not found.' };
        }

        const normalizedActor = event.actor.trim().toLowerCase();
        let lead = get().salesLeads.find(
          (item) =>
            item.stage !== 'Closed' &&
            item.horseId === event.horseId &&
            item.name.trim().toLowerCase() === normalizedActor,
        );
        if (!lead) {
          const created = get().createSalesLead({
            horseId: event.horseId,
            name: event.actor,
            channel: 'Site Inquiry',
            shareReady: true,
          });
          if (!created.ok || !created.id) {
            return created;
          }
          lead = get().salesLeads.find((item) => item.id === created.id);
        }
        if (!lead) {
          return { ok: false, message: 'Buyer lead could not be prepared for follow-up.' };
        }

        const patch = scheduleBuyerActivityFollowUp(lead, event);
        if (!patch) {
          return { ok: false, message: 'Buyer follow-up event not found.' };
        }
        const updated = get().updateSalesLead(lead.id, patch);
        if (!updated.ok) {
          return updated;
        }

        return {
          ok: true,
          id: lead.id,
          message: `Follow-up for ${event.actor} is due today in Sales.`,
        };
      },
      addOwnershipStake: (horseId, stake) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageOwnership');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        if (!stake.name.trim() || !Number.isFinite(stake.share) || stake.share <= 0) {
          return { ok: false, message: 'Co-owner name and share percentage are required.' };
        }

        const targetHorse = get().horses.find((horse) => horse.id === horseId);
        if (!targetHorse) {
          return { ok: false, message: 'Horse record not found for this ownership update.' };
        }

        const horse = get().horses.find((item) => item.id === horseId);
        const currentShareTotal = horse?.ownership.reduce((total, item) => total + item.share, 0) ?? 0;
        if (currentShareTotal + stake.share > 100) {
          return {
            ok: false,
            message: `Ownership split cannot exceed 100%. Current split is ${currentShareTotal}%.`,
          };
        }

        const nextStake: OwnershipStake = {
          id: createId('stake'),
          ...stake,
          name: stake.name.trim(),
          contact: stake.contact.trim(),
        };

        set((state) => ({
          horses: state.horses.map((horse) =>
            horse.id === horseId
              ? {
                  ...horse,
                  ownership: [...horse.ownership, nextStake],
                  activity: [
                    createTimelineEvent({
                      title: 'Ownership updated',
                      summary: `${nextStake.name} added as ${nextStake.role}.`,
                      owner: 'Ownership Desk',
                      date: todayStamp(),
                      category: 'Ownership',
                    }),
                    ...horse.activity,
                  ],
                }
              : horse,
          ),
        }));

        return { ok: true, message: `${nextStake.name} added to the ownership split.`, id: nextStake.id };
      },
      removeOwnershipStake: (horseId, stakeId) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'manageOwnership');
        if (deniedMessage) {
          return { ok: false, message: deniedMessage };
        }

        const horse = get().horses.find((h) => h.id === horseId);
        if (!horse) {
          return { ok: false, message: 'Horse record not found.' };
        }

        const stake = horse.ownership.find((s) => s.id === stakeId);
        if (!stake) {
          return { ok: false, message: 'Ownership stake not found.' };
        }

        set((state) => ({
          horses: state.horses.map((h) =>
            h.id === horseId
              ? {
                  ...h,
                  ownership: h.ownership.filter((s) => s.id !== stakeId),
                  activity: [
                    createTimelineEvent({
                      title: 'Ownership updated',
                      summary: `${stake.name} removed from ownership split.`,
                      owner: 'Ownership Desk',
                      date: todayStamp(),
                      category: 'Ownership',
                    }),
                    ...h.activity,
                  ],
                }
              : h,
          ),
        }));

        return { ok: true, message: `${stake.name} removed from the ownership split.` };
      },
      ensureOwnershipRecord: (horseId) => {
        const existing = get().ownershipRecords.find((r) => r.horseId === horseId);
        if (existing) {
          return { ok: true, message: 'Ownership record already exists.', recordId: existing.id };
        }

        const horse = get().horses.find((h) => h.id === horseId);
        if (!horse) {
          return { ok: false, message: 'Horse record not found.' };
        }

        const newRecord = createOwnershipRecord(horse);
        set((state) => ({
          ownershipRecords: [newRecord, ...state.ownershipRecords],
        }));
        return { ok: true, message: `Ownership record created for ${horse.name}.`, recordId: newRecord.id };
      },
      decideDocumentFact: (horseId, factId, decision) => {
        const deniedMessage = requireRoleCapability(get().currentRole, 'reviewDocuments');
        if (deniedMessage) return { ok: false, message: deniedMessage };
        const horse = get().horses.find((item) => item.id === horseId);
        if (!horse) return { ok: false, message: 'Horse record not found.' };
        if (!horse.documentFacts.some((fact) => fact.id === factId))
          return { ok: false, message: 'OCR fact not found.' };
        set((state) => ({
          horses: state.horses.map((item) =>
            item.id === horseId
              ? {
                  ...item,
                  documentFacts: item.documentFacts.map((fact) => (fact.id === factId ? { ...fact, decision } : fact)),
                  activity: [
                    createTimelineEvent({
                      title: `OCR fact ${decision.toLowerCase()}`,
                      summary: `${factId} was ${decision.toLowerCase()} into the horse record.`,
                      owner: 'Documents',
                      date: todayStamp(),
                      category: 'Operations',
                    }),
                    ...item.activity,
                  ],
                }
              : item,
          ),
        }));
        return { ok: true, message: `OCR fact ${decision.toLowerCase()}.`, id: factId };
      },
      exportWorkspaceBackup: () => ({
        app: 'XBAR',
        version: WORKSPACE_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        workspace: selectPersistedState(get()),
      }),
      importWorkspaceBackup: (backup) => {
        const payload =
          backup && typeof backup === 'object' && 'workspace' in (backup as Record<string, unknown>)
            ? (backup as { workspace: unknown }).workspace
            : backup;
        if (
          !payload ||
          typeof payload !== 'object' ||
          (!('horses' in (payload as Record<string, unknown>)) &&
            !('documents' in (payload as Record<string, unknown>)) &&
            !('subscription' in (payload as Record<string, unknown>)))
        ) {
          return {
            ok: false,
            message: 'Backup file is missing the XBAR workspace payload.',
          };
        }
        const nextState = restorePersistedState(payload);
        set(nextState);
        return {
          ok: true,
          message: `Imported ${nextState.horses.length} horses, ${nextState.documents.length} documents, and ${nextState.salesLeads.length} leads.`,
        };
      },
    }),
    {
      name: 'xbar-live-workspace',
      storage: createJSONStorage(() => workspaceStateStorage),
      version: WORKSPACE_SCHEMA_VERSION,
      migrate: (persistedState) => restorePersistedState(persistedState),
      partialize: (state) =>
        selectPersistedState({
          horses: state.horses,
          documents: state.documents,
          intakeBatches: state.intakeBatches,
          ownershipRecords: state.ownershipRecords,
          auditEvents: state.auditEvents,
          salePacketBuilds: state.salePacketBuilds,
          buyerRoomEvents: state.buyerRoomEvents,
          expenseReceipts: state.expenseReceipts,
          ranchAssets: state.ranchAssets,
          subscription: state.subscription,
          roleWorkspaces: state.roleWorkspaces,
          salesLeads: state.salesLeads,
          sharedListings: state.sharedListings,
          sharedAccess: state.sharedAccess,
          workspaceMembers: state.workspaceMembers,
          workspaceInvitations: state.workspaceInvitations,
          workspaceProfile: state.workspaceProfile,
        }),
    },
  ),
);

export function useCurrentRoleWorkspace() {
  return useXbarStore((state) => {
    const match = state.roleWorkspaces.find((workspace) => workspace.role === state.currentRole);
    return match ?? state.roleWorkspaces[0];
  });
}

export function useHorseRecord(id?: string) {
  return useXbarStore((state) => state.horses.find((horse) => horse.id === id));
}

export function useCurrentRoleCapability(capability: RoleCapability) {
  return useXbarStore((state) => hasRoleCapability(state.currentRole, capability));
}

export function useWorkspaceReady() {
  return useXbarStore((state) => isWorkspaceSetup(state.workspaceProfile));
}

export function useWorkspaceHydrated() {
  const [hydrated, setHydrated] = useState(() => useXbarStore.persist.hasHydrated());

  useEffect(() => {
    const unsubscribeHydrate = useXbarStore.persist.onHydrate(() => setHydrated(false));
    const unsubscribeFinish = useXbarStore.persist.onFinishHydration(() => setHydrated(true));
    setHydrated(useXbarStore.persist.hasHydrated());

    return () => {
      unsubscribeHydrate();
      unsubscribeFinish();
    };
  }, []);

  return hydrated;
}
