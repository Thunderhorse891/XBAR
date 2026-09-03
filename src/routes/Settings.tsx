import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader, Panel, Pill } from '@/components/app-ui';
import { formatDateLabel } from '@/lib/format';
import { loadWorkspaceBackupFromCloud, saveWorkspaceBackupToCloud } from '@/lib/cloudWorkspace';
import {
  isBillingConfigured,
  isFacebookSharingConfigured,
  isRelationalCloudEnabled,
  isSupabaseConfigured,
  isSnapshotFallbackEnabled,
} from '@/lib/platformConfig';
import { isBrowserOnline } from '@/lib/offlineRuntime';
import { workspaceStorageDriverLabel } from '@/lib/workspaceStorage';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import { workspaceBackupPayload } from '@/store/xbarStoreLogic';
import { canRestorePersistedState } from '@/store/xbarStoreHelpers';
import {
  type PortableLocalFile,
  type UnbackedUpFile,
  clearLocalFileVault,
  exportLocalFiles,
  importLocalFiles,
  listLocalFiles,
  referencedVaultKeys,
} from '@/lib/localFileVault';
import { beginVaultWrite, endVaultWrite } from '@/lib/localFileVault';
import { vaultOwnerId } from '@/lib/vaultOwner';
import { promoteLocalVaultFiles } from '@/lib/workspacePromotion';
import type { UserRole } from '@/types/xbar';
import { useEffectiveSubscription } from '@/hooks/useOwnerPreview';

function roleLabel(role: UserRole) {
  return role === 'Owner' ? 'Horse Owner / Client' : role;
}

function roleValue(role: UserRole) {
  if (role === 'Admin')
    return 'Full workspace control, billing, records, users, imports, exports, and final approvals.';
  if (role === 'Ranch Manager')
    return 'Daily operating control for care, documents, horses, expenses, assets, and team workflow.';
  if (role === 'Owner') return 'Client-facing access for assigned horse records and approved shared materials only.';
  if (role === 'Medical Lead') return 'Care, treatment, vet record, Coggins, medication, and medical timeline control.';
  if (role === 'Sales Lead') return 'Buyer follow-up, sale profiles, inquiries, listings, and shared buyer packets.';
  return 'Role-scoped access for the workspace.';
}

export default function Settings() {
  const roleWorkspaces = useXbarStore((state) => state.roleWorkspaces);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const workspaceMembers = useXbarStore((state) => state.workspaceMembers);
  const workspaceInvitations = useXbarStore((state) => state.workspaceInvitations);
  const subscription = useEffectiveSubscription();
  const updateWorkspaceProfile = useXbarStore((state) => state.updateWorkspaceProfile);
  const inviteWorkspaceMember = useXbarStore((state) => state.inviteWorkspaceMember);
  const revokeWorkspaceInvitation = useXbarStore((state) => state.revokeWorkspaceInvitation);
  const activateWorkspaceInvitation = useXbarStore((state) => state.activateWorkspaceInvitation);
  const removeWorkspaceMember = useXbarStore((state) => state.removeWorkspaceMember);
  const exportWorkspaceBackup = useXbarStore((state) => state.exportWorkspaceBackup);
  const importWorkspaceBackup = useXbarStore((state) => state.importWorkspaceBackup);
  const resetWorkspace = useXbarStore((state) => state.resetWorkspace);
  const cloudStatus = useCloudStore((state) => state.status);
  const cloudSession = useCloudStore((state) => state.session);
  const workspaceId = useCloudStore((state) => state.workspaceId);
  const lastCloudSyncAt = useCloudStore((state) => state.lastSyncAt);
  const cloudSyncState = useCloudStore((state) => state.syncState);
  const setLastCloudSyncAt = useCloudStore((state) => state.setLastSyncAt);
  const setCloudSyncState = useCloudStore((state) => state.setSyncState);
  const unlockAutosaveAfterManualSync = useCloudStore((state) => state.unlockAutosaveAfterManualSync);
  const sendMagicLink = useCloudStore((state) => state.sendMagicLink);
  const signInWithFacebook = useCloudStore((state) => state.signInWithFacebook);
  const signOutCloud = useCloudStore((state) => state.signOut);
  const deleteAccount = useCloudStore((state) => state.deleteAccount);
  const navigate = useNavigate();
  const pushToast = useUiStore((state) => state.pushToast);
  const canManageSettings = useCurrentRoleCapability('manageSettings');
  const canSyncCloud = useCurrentRoleCapability('syncCloud');
  const importRef = useRef<HTMLInputElement | null>(null);
  const [profileDraft, setProfileDraft] = useState(workspaceProfile);
  const [authEmail, setAuthEmail] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('Owner');
  const [cloudBusy, setCloudBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [exportingBackup, setExportingBackup] = useState(false);
  const facebookConnected = cloudSession?.user?.app_metadata?.provider === 'facebook';
  const activeMembers = workspaceMembers.filter((member) => member.status === 'Active');
  const pendingInvites = workspaceInvitations.filter((invite) => invite.status === 'Pending');
  const online = isBrowserOnline();

  useEffect(() => {
    setProfileDraft(workspaceProfile);
  }, [workspaceProfile]);

  /*
   * The backup carries the files, not just the records that mention them.
   *
   * The workspace JSON keeps only an opaque `localFileKey` per document and
   * receipt; the bytes live in a separate IndexedDB store. Restored on a second
   * device, every one of those records was listed as stored on-device and could
   * not be opened — the backup a rancher runs precisely so they do not lose
   * their proof was leaving all of it behind.
   */
  const handleExport = async () => {
    if (exportingBackup) return;
    setExportingBackup(true);
    let url = '';
    try {
      const backup = exportWorkspaceBackup();
      const workspace = backup.workspace as {
        documents?: { localFileKey?: string }[];
        expenseReceipts?: { localFileKey?: string }[];
        salePacketBuilds?: { localFileKey?: string }[];
      };
      const { files, skipped } = await exportLocalFiles(
        referencedVaultKeys(
          workspace.documents ?? [],
          workspace.expenseReceipts ?? [],
          workspace.salePacketBuilds ?? [],
        ),
        // A restored record can name a file this workspace does not own. The
        // backup is the one path that COPIES the bytes somewhere they open
        // freely, so the owner has to reach the read.
        vaultOwnerId(),
      );

      /*
       * The omissions travel WITH the archive, not only in the toast.
       *
       * A file left out here — missing, unreadable, or past the size budget —
       * produced a warning that lived exactly as long as the toast. The archive
       * itself recorded nothing, so importing it months later restored records
       * pointing at files that were never in the backup, and reported an
       * ordinary success: import can only report entries it was given and
       * failed to write, and these were never given.
       *
       * Recording them means a restore can say which files to go and find, and
       * why they are not here.
       */
      const blob = new Blob([JSON.stringify({ ...backup, files, omittedFiles: skipped }, null, 2)], {
        type: 'application/json',
      });
      url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `xbar-workspace-${backup.exportedAt.slice(0, 10)}.json`;
      anchor.click();

      // What went in, and what did not. A backup that quietly omits files is
      // the failure this change exists to remove, so an incomplete one says so
      // rather than reporting plain success.
      const fileSummary = files.length
        ? `${files.length} file${files.length === 1 ? '' : 's'} included.`
        : 'No files were stored on this device.';
      pushToast({
        title: skipped.length ? 'Backup exported — some files not included' : 'Backup exported',
        message: skipped.length
          ? `${fileSummary} ${skipped.length} could not be included: ${skipped.map((entry) => `${entry.name} (${entry.reason})`).join('; ')}`
          : `Ranch backup downloaded. ${fileSummary}`,
        tone: skipped.length ? 'warning' : 'success',
      });
    } catch {
      pushToast({
        title: 'Backup failed',
        message: 'The ranch backup could not be exported.',
        tone: 'error',
      });
    } finally {
      if (url) URL.revokeObjectURL(url);
      setExportingBackup(false);
    }
  };

  const accountEmail = cloudSession?.user?.email ?? '';
  const canConfirmDelete =
    accountEmail.length > 0 && deleteConfirm.trim().toLowerCase() === accountEmail.trim().toLowerCase();

  const handleDeleteAccount = async () => {
    if (!canConfirmDelete || deleting) return;

    /*
     * Captured BEFORE anything is cleared, and that ordering is the whole fix.
     *
     * `deleteAccount` clears the cloud workspace id and `resetWorkspace` erases
     * the records, so reading either afterwards answered for a workspace that
     * no longer existed: every successful cloud deletion purged as `'local'`
     * with an empty key list. The deleted account's files stayed on the device,
     * and this browser's LOCAL-only workspace had its files deleted instead —
     * wrong in both directions at once.
     */
    const departingWorkspaceId = vaultOwnerId();
    const departing = exportWorkspaceBackup().workspace as {
      documents?: { localFileKey?: string }[];
      expenseReceipts?: { localFileKey?: string }[];
      salePacketBuilds?: { localFileKey?: string }[];
    };
    const departingKeys = referencedVaultKeys(
      departing.documents ?? [],
      departing.expenseReceipts ?? [],
      departing.salePacketBuilds ?? [],
    );

    setDeleting(true);
    const result = await deleteAccount(deleteConfirm);
    setDeleting(false);
    if (!result.ok) {
      pushToast({ title: 'Deletion failed', message: result.message, tone: 'error' });
      return;
    }
    // Purge the on-device workspace copy so no data lingers after the account is
    // gone server-side. Reset the in-memory state FIRST so a later store write
    // (e.g. CloudBootstrap adjusting the role on sign-out) can't re-persist the
    // deleted user's data, then clear the backing storage.
    resetWorkspace();
    try {
      await useXbarStore.persist.clearStorage();
    } catch {
      // best effort — the account is already deleted on the server
    }
    // The files live in their own database, which `persist.clearStorage` knows
    // nothing about. Without this, registration papers, receipts and generated
    // packets stayed on the device while the UI reported the account
    // permanently deleted.
    // Scoped to the workspace being deleted, plus whatever its own records
    // pointed at — both captured at the top, while they still existed. The
    // vault is origin-wide: dropping the database would take a second account's
    // documents with it, and this browser may well hold one.
    const { cleared } = await clearLocalFileVault(departingWorkspaceId, departingKeys);
    setDeleteConfirm('');
    // The server side is done either way — the account is gone. But if this
    // browser refused to drop the file database, the proof documents are still
    // on this machine, and "permanently deleted" would be false about the part
    // the person can still see.
    pushToast({
      title: cleared ? 'Account deleted' : 'Account deleted — files still on this device',
      message: cleared
        ? result.message
        : `${result.message} This browser would not remove the files stored on this device; close other XBAR tabs and clear this site's data to finish removing them.`,
      tone: cleared ? 'success' : 'warning',
    });
    navigate('/login', { replace: true });
  };

  const handleImport = async (file?: File) => {
    if (!file) return;
    /*
     * `importLocalFiles` writes every blob before `importWorkspaceBackup`
     * installs the records that reference them. Until it does, those bytes are
     * in the vault and unreferenced, which is exactly what the orphan sweep
     * deletes — so a cloud reconciliation settling mid-import destroyed files
     * this had just restored, and left the restored records dangling.
     */
    beginVaultWrite();
    try {
      const text = await file.text();
      const payload = JSON.parse(text) as { files?: PortableLocalFile[]; omittedFiles?: UnbackedUpFile[] };

      /*
       * Validate, then write files, then write records.
       *
       * The order is load-bearing in both directions. Files must land before
       * the records that point at them, or a record briefly references a blob
       * that is not there yet. But the vault must not be touched at all until
       * the workspace payload is known to be acceptable: restoration preserves
       * keys and uses `put`, so writing first and rejecting after would
       * overwrite blobs belonging to the workspace currently loaded and then
       * report "Import blocked" — leaving real documents silently pointing at
       * some other file's bytes.
       */
      const workspace = workspaceBackupPayload(payload);
      if (!workspace) {
        pushToast({
          title: 'Import blocked',
          message: 'Backup file is missing the XBAR workspace payload.',
          tone: 'error',
        });
        return;
      }

      /*
       * The shape check is a precondition, not a guarantee.
       *
       * `{ workspace: { horses: [null] } }` has a `horses` key and passes it,
       * then `restorePersistedState` dereferences the null and throws — after
       * the vault has already been overwritten. So the real normalization runs
       * first, on a payload that has not touched anything yet.
       */
      if (!canRestorePersistedState(workspace)) {
        pushToast({
          title: 'Import blocked',
          message: 'This backup file is damaged and could not be read. Nothing on this device was changed.',
          tone: 'error',
        });
        return;
      }

      // Restored under their ORIGINAL keys — a fresh key would leave every
      // document pointing at nothing. A backup written before this shipped has
      // no `files`, and restores exactly as it always did.
      /*
       * A restored file is NEVER treated as XBAR-generated.
       *
       * My previous attempt derived provenance from the archive's own
       * `salePacketBuilds`, calling them validated — but `canRestorePersistedState`
       * only requires a non-empty id, so a crafted backup could carry a packet
       * record whose `localFileKey` points at an arbitrary HTML entry. That
       * entry would be stored `generated: true`, bypass the inert-MIME
       * allowlist, and execute attacker script in this origin the moment the
       * "packet" was opened — on any host without the Vercel CSP, which
       * includes the supported local and static-preview builds.
       *
       * Executable provenance cannot be derived from anything the archive
       * controls, and every route into it here is archive-controlled. So a
       * restored packet is download-only. It is still complete and still
       * verifiable: opened from disk it is not same-origin with XBAR, and its
       * verifier runs there with no CSP to satisfy.
       */
      const { restored, failed, remapped } = Array.isArray(payload.files)
        ? await importLocalFiles(payload.files, { workspaceId: vaultOwnerId() })
        : { restored: 0, failed: [] as UnbackedUpFile[], remapped: {} as Record<string, string> };

      /*
       * Follow any keys the vault had to re-mint.
       *
       * A key in this backup can already exist in the origin-wide vault owned by
       * ANOTHER account in this browser. Restoring over it would destroy that
       * account's only local copy, so the vault mints a fresh key instead — and
       * the restored records still point at the old one until they are rewritten
       * here. Without this the file lands and the document opens to nothing.
       */
      if (Object.keys(remapped).length > 0) {
        for (const group of ['documents', 'expenseReceipts', 'salePacketBuilds'] as const) {
          const records = (workspace as Record<string, unknown>)[group];
          if (!Array.isArray(records)) continue;
          for (const record of records as { localFileKey?: string }[]) {
            const next = record?.localFileKey ? remapped[record.localFileKey] : undefined;
            if (next) record.localFileKey = next;
          }
        }
      }

      const result = importWorkspaceBackup(payload);

      /*
       * Reconcile what the workspace REFERENCES against what the vault holds.
       *
       * `failed` covers only files that were in the archive and would not
       * write. It cannot see a file the export left out, because that file is
       * not in `payload.files` at all — and those are the ones that matter,
       * since they are exactly the records that now point at nothing.
       *
       * Asking the vault after the restore catches all of it at once: files
       * omitted at export, an archive truncated or hand-edited since, and a
       * backup written before omissions were recorded. The archive's own
       * `omittedFiles` list is used only to say WHY, which reconciliation
       * cannot reconstruct.
       */
      let danglingNote = '';
      if (result.ok) {
        try {
          // Read back what was actually restored, through the same accessor
          // the export used — so the two sides ask the same question.
          const restoredWorkspace = exportWorkspaceBackup().workspace as {
            documents?: { localFileKey?: string }[];
            expenseReceipts?: { localFileKey?: string }[];
            salePacketBuilds?: { localFileKey?: string }[];
          };
          const referenced = referencedVaultKeys(
            restoredWorkspace.documents ?? [],
            restoredWorkspace.expenseReceipts ?? [],
            restoredWorkspace.salePacketBuilds ?? [],
          );
          /*
           * Held BY THIS WORKSPACE. The vault is origin-wide, so "the key is in
           * the vault" was never the question.
           *
           * A file omitted from the archive never passes through
           * `importLocalFiles`, so its key is not remapped and the restored
           * record keeps the ORIGINAL workspace's key. Counting any vault entry
           * as held then reported that record as fine while it pointed at
           * another account's document — the one case where the note most
           * needed to fire.
           *
           * Untagged entries count as held: they predate ownership being
           * recorded, and calling a person's own legacy file missing is a false
           * alarm. Only a proven foreign owner is treated as unresolved.
           */
          const owner = vaultOwnerId();
          const held = new Set(
            (await listLocalFiles())
              .filter((entry) => entry.workspaceId === undefined || entry.workspaceId === owner)
              .map((entry) => entry.key),
          );
          const dangling = referenced.filter((key) => !held.has(key));

          if (dangling.length) {
            /*
             * Keyed by the vault key, because that is what a dangling record
             * names. `entry.name` is the fallback for archives written before
             * the key was recorded — those stored the display filename under
             * `name`, so matching on it keeps their reasons readable.
             */
            const omissions = new Map(
              (Array.isArray(payload.omittedFiles) ? payload.omittedFiles : []).map((entry) => [
                entry.key || entry.name,
                entry,
              ]),
            );
            const named = dangling
              .slice(0, 5)
              .map((key) => {
                const omission = omissions.get(key);
                if (!omission) return key;
                // The filename is what the person recognises; the key is not.
                return `${omission.name || key} (${omission.reason})`;
              })
              .join('; ');
            danglingNote = ` ${dangling.length} record${dangling.length === 1 ? '' : 's'} still point at ${
              dangling.length === 1 ? 'a file' : 'files'
            } that is not on this device: ${named}${dangling.length > 5 ? '; …' : ''}`;
          }
        } catch {
          // The vault being unreadable is its own failure and is reported where
          // files are used. Not being able to COUNT the gaps must not turn a
          // successful restore into a failed one.
          danglingNote = ' Files on this device could not be checked against the restored records.';
        }
      }

      // A file that did not come back leaves a record pointing at nothing, and
      // this is the only place the rancher can be told which one.
      const restoredNote = restored ? ` ${restored} file${restored === 1 ? '' : 's'} restored to this device.` : '';
      const failedNote = failed.length
        ? ` ${failed.length} could not be restored: ${failed.map((entry) => `${entry.name} (${entry.reason})`).join('; ')}`
        : '';

      const incomplete = failed.length > 0 || danglingNote !== '';
      pushToast({
        title: !result.ok ? 'Import blocked' : incomplete ? 'Backup imported — some files missing' : 'Backup imported',
        message: result.ok ? `${result.message}${restoredNote}${failedNote}${danglingNote}` : result.message,
        tone: !result.ok ? 'error' : incomplete ? 'warning' : 'success',
      });
    } catch {
      pushToast({ title: 'Import failed', message: 'Choose a valid XBAR backup JSON file.', tone: 'error' });
    } finally {
      // Released on every path, including the catch above.
      endVaultWrite();
      if (importRef.current) importRef.current.value = '';
    }
  };

  const handleProfileSave = () => {
    if (!profileDraft.ranchName.trim() || !profileDraft.businessName.trim()) {
      pushToast({ title: 'Profile not saved', message: 'Business name and ranch name are required.', tone: 'error' });
      return;
    }
    if (
      profileDraft.operationsEmail.trim() &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileDraft.operationsEmail.trim())
    ) {
      pushToast({ title: 'Profile not saved', message: 'Operations email must be a valid address.', tone: 'error' });
      return;
    }
    const result = updateWorkspaceProfile(profileDraft);
    pushToast({
      title: result.ok ? 'Profile saved' : 'Profile not saved',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
  };

  const handleSendMagicLink = async () => {
    setCloudBusy(true);
    const result = await sendMagicLink(authEmail);
    pushToast({
      title: result.ok ? 'Magic link sent' : 'Sign-in blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    setCloudBusy(false);
  };

  const handlePushCloud = async () => {
    setCloudBusy(true);
    const backup = exportWorkspaceBackup();
    const result = await saveWorkspaceBackupToCloud(backup);

    /*
     * The same promotion CloudBootstrap performs, because this is the button
     * the conflict-lock message sends people to: "Autosave is locked until you
     * choose Push cloud or Pull cloud in Settings." Pushing the records without
     * handing over their files leaves the signed-in workspace unable to open a
     * single one of the documents it just uploaded.
     */
    const promoted = result.ok
      ? await promoteLocalVaultFiles(backup.workspace as Parameters<typeof promoteLocalVaultFiles>[0], vaultOwnerId())
      : { adopted: 0, failed: [] };

    pushToast({
      title: result.ok ? 'Cloud sync complete' : 'Cloud sync failed',
      message: promoted.failed.length
        ? `${result.message} ${promoted.failed.length} file${promoted.failed.length === 1 ? '' : 's'} on this device could not be moved to the cloud workspace yet and will be retried.`
        : result.message,
      tone: result.ok && !promoted.failed.length ? 'success' : 'error',
    });
    if (result.ok && result.updatedAt) setLastCloudSyncAt(result.updatedAt);
    /*
     * Choosing a copy is what `conflict-lock` was waiting for, and nothing else
     * clears it: reconciliation runs once per hydration and its effect is keyed
     * on the workspace and the session, neither of which changes when this
     * button is pressed. Without this the rancher is told the sync completed,
     * every later edit is skipped by autosave, and the cloud silently stops
     * receiving work until the tab is reloaded.
     *
     * Unlocked on `result.ok` even when some files could not be promoted — the
     * same condition that already advances the sync timestamp. The records are
     * in the cloud and the conflict is settled; the files retry on their own,
     * and staying locked over a retry is the failure this fixes.
     */
    if (result.ok) {
      unlockAutosaveAfterManualSync();
      setCloudSyncState('idle', 'Cloud workspace ready.');
    }
    setCloudBusy(false);
  };

  const handlePullCloud = async () => {
    setCloudBusy(true);
    const remote = await loadWorkspaceBackupFromCloud();
    if (!remote.ok) {
      pushToast({ title: 'Cloud pull failed', message: remote.message, tone: 'error' });
      setCloudBusy(false);
      return;
    }
    const result = importWorkspaceBackup(remote.backup);
    pushToast({
      title: result.ok ? 'Cloud workspace loaded' : 'Cloud import blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok && remote.updatedAt) setLastCloudSyncAt(remote.updatedAt);
    // The other half of the same choice: taking the cloud copy settles the
    // conflict exactly as pushing the local one does.
    if (result.ok) {
      unlockAutosaveAfterManualSync();
      setCloudSyncState('idle', 'Cloud workspace ready.');
    }
    setCloudBusy(false);
  };

  const handleSignOutCloud = async () => {
    setCloudBusy(true);
    const result = await signOutCloud();
    pushToast({
      title: result.ok ? 'Signed out' : 'Sign-out failed',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    setCloudBusy(false);
  };

  const handleFacebookConnect = async () => {
    setCloudBusy(true);
    const result = await signInWithFacebook();
    pushToast({
      title: result.ok ? 'Facebook connect started' : 'Facebook connect failed',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    setCloudBusy(false);
  };

  const handleInviteMember = async () => {
    const result = await inviteWorkspaceMember(inviteEmail, inviteRole);
    pushToast({
      title: result.ok ? 'Invite created' : 'Invite blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok) {
      setInviteEmail('');
      setInviteRole('Owner');
    }
  };

  return (
    <>
      <PageHeader eyebrow="Settings" title="Settings" />

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Access model" title="Commercial barn permissions">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Role-based access protects the business model</div>
                <Pill tone="blue">Multi-user</Pill>
              </div>
              <div className="stack-item__copy">
                Owners, vets, medical leads, sales leads, and staff should never need full admin access. XBAR separates
                workspace control from horse/client-facing access so commercial barns can invite people without exposing
                the whole operation.
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Offline-capable browser workspace</div>
                <Pill tone={online ? 'emerald' : 'amber'}>{online ? 'Online' : 'Offline'}</Pill>
              </div>
              <div className="stack-item__copy">
                The app registers an offline shell and keeps local workspace data available in the browser. Barn staff
                can keep working through poor signal, then use cloud sync when service is available.
              </div>
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Cloud" title="Cloud">
          {isSupabaseConfigured() ? (
            cloudSession ? (
              <>
                <div className="stack-list">
                  <div className="stack-item">
                    <div className="stack-item__top">
                      <div className="stack-item__title">{cloudSession.user.email ?? 'Signed-in user'}</div>
                      <div className="status-inline">
                        <Pill tone="emerald">{cloudStatus === 'signed-in' ? 'Connected' : 'Ready'}</Pill>
                        <Pill
                          tone={cloudSyncState === 'error' ? 'rose' : cloudSyncState === 'syncing' ? 'amber' : 'blue'}
                        >
                          {cloudSyncState === 'syncing'
                            ? 'Syncing'
                            : cloudSyncState === 'error'
                              ? 'Sync issue'
                              : 'Autosave on'}
                        </Pill>
                      </div>
                    </div>
                    <div className="inline-metrics">
                      <span>
                        {workspaceId ? `Ranch ${workspaceId.slice(0, 8)}` : `User ${cloudSession.user.id.slice(0, 8)}`}
                      </span>
                      <span>
                        {lastCloudSyncAt ? `Last sync ${formatDateLabel(lastCloudSyncAt)}` : 'No cloud sync yet'}
                      </span>
                      <span>
                        {cloudSyncState === 'syncing'
                          ? 'Saving relational records'
                          : cloudSyncState === 'error'
                            ? 'Needs retry'
                            : 'Watching workspace changes'}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="inline-actions">
                  <button
                    className="button button--primary button--compact"
                    type="button"
                    onClick={handlePushCloud}
                    disabled={!canSyncCloud || cloudBusy}
                  >
                    {cloudBusy ? 'Working...' : 'Push cloud'}
                  </button>
                  <button
                    className="button button--ghost button--compact"
                    type="button"
                    onClick={handlePullCloud}
                    disabled={!canSyncCloud || cloudBusy}
                  >
                    Pull cloud
                  </button>
                  <button
                    className="button button--ghost button--compact"
                    type="button"
                    onClick={handleSignOutCloud}
                    disabled={!canSyncCloud || cloudBusy}
                  >
                    Sign out
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="form-grid form-grid--tight">
                  <label className="field-stack">
                    <span className="field-label">Email</span>
                    <input
                      className="field-input"
                      type="email"
                      value={authEmail}
                      onChange={(event) => setAuthEmail(event.target.value)}
                      disabled={!canSyncCloud}
                    />
                  </label>
                </div>
                <div className="inline-actions">
                  <button
                    className="button button--primary button--compact"
                    type="button"
                    onClick={handleSendMagicLink}
                    disabled={!canSyncCloud || cloudBusy || !authEmail.trim()}
                  >
                    {cloudBusy ? 'Sending...' : 'Send magic link'}
                  </button>
                </div>
              </>
            )
          ) : (
            <div className="bullet-list">
              <div className="bullet-list__item">
                Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to turn on cloud auth and sync.
              </div>
              <div className="bullet-list__item">Until then, this ranch data stays local to this browser.</div>
            </div>
          )}
        </Panel>

        <Panel eyebrow="Ranch profile" title="Profile">
          <div className="form-grid form-grid--tight">
            <label className="field-stack">
              <span className="field-label">Business name</span>
              <input
                className="field-input"
                value={profileDraft.businessName}
                onChange={(event) => setProfileDraft((current) => ({ ...current, businessName: event.target.value }))}
                disabled={!canManageSettings}
              />
            </label>
            <label className="field-stack">
              <span className="field-label">Ranch name</span>
              <input
                className="field-input"
                value={profileDraft.ranchName}
                onChange={(event) => setProfileDraft((current) => ({ ...current, ranchName: event.target.value }))}
                disabled={!canManageSettings}
              />
            </label>
            <label className="field-stack">
              <span className="field-label">Default owner</span>
              <input
                className="field-input"
                value={profileDraft.defaultOwnerName}
                onChange={(event) =>
                  setProfileDraft((current) => ({ ...current, defaultOwnerName: event.target.value }))
                }
                disabled={!canManageSettings}
              />
            </label>
            <label className="field-stack">
              <span className="field-label">Default owner entity</span>
              <input
                className="field-input"
                value={profileDraft.defaultOwnerEntity}
                onChange={(event) =>
                  setProfileDraft((current) => ({ ...current, defaultOwnerEntity: event.target.value }))
                }
                disabled={!canManageSettings}
              />
            </label>
            <label className="field-stack">
              <span className="field-label">Ranch manager</span>
              <input
                className="field-input"
                value={profileDraft.ranchManagerName}
                onChange={(event) =>
                  setProfileDraft((current) => ({ ...current, ranchManagerName: event.target.value }))
                }
                disabled={!canManageSettings}
              />
            </label>
            <label className="field-stack">
              <span className="field-label">Default barn</span>
              <input
                className="field-input"
                value={profileDraft.defaultBarn}
                onChange={(event) => setProfileDraft((current) => ({ ...current, defaultBarn: event.target.value }))}
                disabled={!canManageSettings}
              />
            </label>
            <label className="field-stack">
              <span className="field-label">Default pasture</span>
              <input
                className="field-input"
                value={profileDraft.defaultPasture}
                onChange={(event) => setProfileDraft((current) => ({ ...current, defaultPasture: event.target.value }))}
                disabled={!canManageSettings}
              />
            </label>
            <label className="field-stack">
              <span className="field-label">Operations email</span>
              <input
                className="field-input"
                value={profileDraft.operationsEmail}
                onChange={(event) =>
                  setProfileDraft((current) => ({ ...current, operationsEmail: event.target.value }))
                }
                disabled={!canManageSettings}
              />
            </label>
          </div>
          <div className="inline-actions">
            <button
              className="button button--primary button--compact"
              type="button"
              onClick={handleProfileSave}
              disabled={!canManageSettings}
            >
              Save profile
            </button>
          </div>
        </Panel>

        <Panel eyebrow="Ranch access" title="Access">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Seats</div>
                <div className="status-inline">
                  <Pill tone={subscription.usage.seatsUsed >= subscription.usage.seatLimit ? 'rose' : 'blue'}>
                    {subscription.usage.seatsUsed}/{subscription.usage.seatLimit}
                  </Pill>
                  <Pill
                    tone={
                      subscription.usage.sharedAccessSeatsUsed >= subscription.usage.sharedAccessSeatLimit &&
                      subscription.usage.sharedAccessSeatLimit > 0
                        ? 'rose'
                        : 'emerald'
                    }
                  >
                    {subscription.usage.sharedAccessSeatsUsed}/{subscription.usage.sharedAccessSeatLimit} shared
                  </Pill>
                </div>
              </div>
              <div className="inline-metrics">
                <span>{activeMembers.length} active members</span>
                <span>{pendingInvites.length} pending invites</span>
                <span>
                  {isSupabaseConfigured()
                    ? 'Email sign-in accepts invites automatically'
                    : 'Browser access can confirm invites manually'}
                </span>
              </div>
            </div>
          </div>
          <div className="form-grid form-grid--tight">
            <label className="field-stack">
              <span className="field-label">Invite email</span>
              <input
                className="field-input"
                type="email"
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                disabled={!canManageSettings}
              />
            </label>
            <label className="field-stack">
              <span className="field-label">Role</span>
              <select
                className="field-input"
                value={inviteRole}
                onChange={(event) => setInviteRole(event.target.value as UserRole)}
                disabled={!canManageSettings}
              >
                <option value="Admin">Admin</option>
                <option value="Ranch Manager">Ranch Manager</option>
                <option value="Owner">Horse Owner / Client</option>
                <option value="Medical Lead">Medical Lead</option>
                <option value="Sales Lead">Sales Lead</option>
              </select>
            </label>
          </div>
          <div className="stack-item">
            <div className="stack-item__title">Selected role: {roleLabel(inviteRole)}</div>
            <div className="stack-item__copy">{roleValue(inviteRole)}</div>
          </div>
          <div className="inline-actions">
            <button
              className="button button--primary button--compact"
              type="button"
              onClick={handleInviteMember}
              disabled={!canManageSettings || !inviteEmail.trim()}
            >
              Invite member
            </button>
          </div>
          <div className="detail-grid">
            <div className="panel panel--nested">
              <div className="panel__header panel__header--compact">
                <div>
                  <div className="panel__eyebrow">Members</div>
                  <h3 className="panel__title">Active team</h3>
                </div>
              </div>
              <div className="stack-list">
                {activeMembers.length ? (
                  activeMembers.map((member) => (
                    <div key={member.id} className="stack-item">
                      <div className="stack-item__top">
                        <div>
                          <div className="stack-item__title">{member.email}</div>
                          <div className="stack-item__copy">
                            {roleLabel(member.role)} ·{' '}
                            {member.source === 'Owner' ? 'Ranch owner' : `Joined ${formatDateLabel(member.joinedAt)}`}
                          </div>
                        </div>
                        <div className="status-inline">
                          <Pill tone={member.role === 'Admin' ? 'blue' : member.role === 'Owner' ? 'emerald' : 'slate'}>
                            {roleLabel(member.role)}
                          </Pill>
                          <Pill tone="emerald">Active</Pill>
                        </div>
                      </div>
                      <div className="stack-item__copy">{roleValue(member.role)}</div>
                      <div className="inline-actions">
                        <button
                          className="button button--ghost button--compact"
                          type="button"
                          onClick={async () => {
                            const result = await removeWorkspaceMember(member.id);
                            pushToast({
                              title: result.ok ? 'Member removed' : 'Removal blocked',
                              message: result.message,
                              tone: result.ok ? 'success' : 'error',
                            });
                          }}
                          disabled={!canManageSettings}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="stack-item">
                    <div className="stack-item__copy">No active members yet.</div>
                  </div>
                )}
              </div>
            </div>
            <div className="panel panel--nested">
              <div className="panel__header panel__header--compact">
                <div>
                  <div className="panel__eyebrow">Invites</div>
                  <h3 className="panel__title">Pending</h3>
                </div>
              </div>
              <div className="stack-list">
                {pendingInvites.length ? (
                  pendingInvites.map((invite) => (
                    <div key={invite.id} className="stack-item">
                      <div className="stack-item__top">
                        <div>
                          <div className="stack-item__title">{invite.email}</div>
                          <div className="stack-item__copy">
                            {roleLabel(invite.role)} · Sent {formatDateLabel(invite.invitedAt)}
                          </div>
                        </div>
                        <Pill tone={invite.role === 'Owner' ? 'emerald' : 'blue'}>{roleLabel(invite.role)}</Pill>
                      </div>
                      <div className="stack-item__copy">{roleValue(invite.role)}</div>
                      <div
                        className="stack-item__copy"
                        style={{
                          fontFamily: 'monospace',
                          fontSize: '12px',
                          color: 'var(--muted)',
                          wordBreak: 'break-all',
                        }}
                      >
                        Invite code: {invite.id}
                      </div>
                      <div className="inline-actions">
                        <button
                          className="button button--ghost button--compact"
                          type="button"
                          onClick={() => {
                            void navigator.clipboard
                              .writeText(invite.id)
                              .then(() => {
                                pushToast({
                                  title: 'Invite code copied',
                                  message: 'Share this code with the invitee so they can join the workspace.',
                                  tone: 'success',
                                });
                              })
                              .catch(() => {
                                pushToast({
                                  title: 'Copy failed',
                                  message: 'Copy the invite code manually.',
                                  tone: 'error',
                                });
                              });
                          }}
                        >
                          Copy code
                        </button>
                        {!isSupabaseConfigured() ? (
                          <button
                            className="button button--ghost button--compact"
                            type="button"
                            onClick={() => {
                              const result = activateWorkspaceInvitation(invite.id);
                              pushToast({
                                title: result.ok ? 'Invite activated' : 'Activation blocked',
                                message: result.message,
                                tone: result.ok ? 'success' : 'error',
                              });
                            }}
                            disabled={!canManageSettings}
                          >
                            Mark joined
                          </button>
                        ) : null}
                        <button
                          className="button button--ghost button--compact"
                          type="button"
                          onClick={async () => {
                            const result = await revokeWorkspaceInvitation(invite.id);
                            pushToast({
                              title: result.ok ? 'Invite revoked' : 'Revoke blocked',
                              message: result.message,
                              tone: result.ok ? 'success' : 'error',
                            });
                          }}
                          disabled={!canManageSettings}
                        >
                          Revoke
                        </button>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="stack-item">
                    <div className="stack-item__copy">No invites are holding seats right now.</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Role matrix" title="Roles">
          <div className="stack-list">
            {roleWorkspaces.map((workspace) => (
              <div key={workspace.role} className="stack-item">
                <div className="stack-item__top">
                  <div className="stack-item__title">{workspace.role}</div>
                  <Pill tone="blue">{workspace.primaryModules.length} modules</Pill>
                </div>
                <div className="stack-item__copy">{roleValue(workspace.role)}</div>
                <div className="token-row">
                  {workspace.permissions.map((permission) => (
                    <Pill key={permission}>{permission}</Pill>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="Channels" title="Facebook">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Share dialog</div>
                <div className="status-inline">
                  <Pill tone={isFacebookSharingConfigured() ? 'emerald' : 'slate'}>
                    {isFacebookSharingConfigured() ? 'Configured' : 'App ID missing'}
                  </Pill>
                  <Pill tone={facebookConnected ? 'emerald' : 'slate'}>
                    {facebookConnected ? 'Connected' : 'Not connected'}
                  </Pill>
                </div>
              </div>
              <div className="inline-metrics">
                <span>Sale listing links can open in Facebook</span>
                <span>Post flow uses Facebook&apos;s own share window</span>
              </div>
            </div>
          </div>
          <div className="inline-actions">
            <button
              className="button button--primary button--compact"
              type="button"
              onClick={handleFacebookConnect}
              disabled={!canSyncCloud || cloudBusy || !isSupabaseConfigured()}
            >
              {facebookConnected ? 'Reconnect Facebook' : 'Connect Facebook'}
            </button>
          </div>
        </Panel>

        <Panel eyebrow="Runtime" title="Capabilities">
          <div className="token-row">
            <Pill tone={isSupabaseConfigured() ? 'blue' : 'slate'}>
              {isSupabaseConfigured() ? 'Cloud auth on' : 'Cloud auth off'}
            </Pill>
            <Pill tone={cloudSession ? 'emerald' : 'slate'}>
              {cloudSession ? 'Cloud session live' : 'Local session'}
            </Pill>
            <Pill tone={online ? 'emerald' : 'amber'}>{online ? 'Browser online' : 'Browser offline'}</Pill>
            <Pill tone="blue">Offline shell registered</Pill>
            <Pill tone={isRelationalCloudEnabled() ? 'emerald' : 'slate'}>
              {isRelationalCloudEnabled() ? 'Relational sync on' : 'Snapshot-only sync'}
            </Pill>
            <Pill tone={isSnapshotFallbackEnabled() ? 'blue' : 'slate'}>
              {isSnapshotFallbackEnabled() ? 'Snapshot fallback on' : 'Snapshot fallback off'}
            </Pill>
            <Pill tone={isBillingConfigured() ? 'emerald' : 'slate'}>
              {isBillingConfigured() ? 'Managed billing live' : 'Managed billing paused'}
            </Pill>
            <Pill tone={isFacebookSharingConfigured() ? 'emerald' : 'slate'}>
              {isFacebookSharingConfigured() ? 'Facebook share live' : 'Facebook share off'}
            </Pill>
            <Pill tone="blue">{workspaceStorageDriverLabel}</Pill>
            <Pill tone="slate">Review queue</Pill>
          </div>
        </Panel>
      </div>

      <Panel eyebrow="Ranch backup" title="Backups">
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(event) => void handleImport(event.target.files?.[0])}
        />
        <div className="stack-list">
          <div className="stack-item">
            <div className="stack-item__top">
              <div className="stack-item__title">Storage driver</div>
              <Pill tone="blue">{workspaceStorageDriverLabel}</Pill>
            </div>
          </div>
        </div>
        <div className="inline-actions">
          <button
            className="button button--primary button--compact"
            type="button"
            onClick={() => void handleExport()}
            disabled={!canManageSettings || exportingBackup}
          >
            {exportingBackup ? 'Preparing backup...' : 'Export backup'}
          </button>
          <button
            className="button button--ghost button--compact"
            type="button"
            onClick={() => importRef.current?.click()}
            disabled={!canManageSettings}
          >
            Import backup
          </button>
        </div>
      </Panel>

      {isSupabaseConfigured() && cloudSession ? (
        <Panel
          eyebrow="Danger zone"
          title="Delete account"
          description="Permanently delete your XBAR account and the data you own. This cannot be undone."
        >
          <p className="settings-danger-note">
            Deleting your account removes your login and permanently erases every workspace you solely own — horses,
            documents, sale packets, and receipts. Workspaces you share with other people simply lose your access.
          </p>
          <div className="settings-danger-confirm">
            <label className="field">
              <span className="field__label">Type your email to confirm</span>
              <input
                className="field-input"
                type="email"
                autoComplete="off"
                spellCheck={false}
                placeholder={accountEmail}
                value={deleteConfirm}
                onChange={(event) => setDeleteConfirm(event.target.value)}
                aria-label="Type your account email to confirm account deletion"
              />
            </label>
            <button
              className="button button--danger button--compact"
              type="button"
              onClick={() => void handleDeleteAccount()}
              disabled={!canConfirmDelete || deleting}
            >
              {deleting ? 'Deleting…' : 'Permanently delete my account'}
            </button>
          </div>
        </Panel>
      ) : null}
    </>
  );
}
