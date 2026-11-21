import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Panel } from '@/components/app-ui';
import { readAuthStorage } from '@/lib/authStorage';
import { authStorageKey } from '@/lib/supabaseClient';
import { clearLocalFileVault, referencedVaultKeys } from '@/lib/localFileVault';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import { readRecordsOwner } from '@/lib/recordsOwner';
import { captureWorkspaceDeletionSnapshot, clearCapturedWorkspaceDeletion } from '@/lib/workspaceStorage';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';

const activeRequests = new Set<string>();

export function AccountDeletionPanel({
  compact = false,
  disabled = false,
  onBusyChange,
}: {
  compact?: boolean;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const session = useCloudStore((state) => state.session);
  const navigate = useNavigate();
  const pushToast = useUiStore((state) => state.pushToast);
  const [confirmation, setConfirmation] = useState({ accountId: '', email: '' });
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');
  const submitLock = useRef(false);

  if (!isSupabaseConfigured() || !session?.user.id || !session.user.email) return null;
  const accountId = session.user.id;
  const accountEmail = session.user.email;
  const email = confirmation.accountId === accountId ? confirmation.email : '';
  const confirmed = email.trim().toLowerCase() === accountEmail.trim().toLowerCase();

  async function performDeletion() {
    if (disabled || submitLock.current || !confirmed || activeRequests.has(accountId)) return;

    const cloud = useCloudStore.getState();
    if (cloud.session?.user.id !== accountId) return;
    const accountOwner = `account:${accountId}`;
    // The pre-setup surface never assumes it owns a ranch namespace, even if
    // a previous scope is still being reconciled in the background.
    const departingOwner = (!compact && cloud.workspaceId) || accountOwner;
    // The candidate owner and actual installed records are separate pieces
    // of evidence: onboarding may run with another ranch still on-device.
    const ownerVerified =
      readRecordsOwner() === departingOwner &&
      (departingOwner === accountOwner || (cloud.autosaveReady && cloud.autosaveUnlocked));
    const workspace = useXbarStore.getState();
    const fileKeys = ownerVerified
      ? referencedVaultKeys(workspace.documents, workspace.expenseReceipts, workspace.salePacketBuilds)
      : [];

    submitLock.current = true;
    activeRequests.add(accountId);
    setDeleting(true);
    onBusyChange?.(true);
    setError('');
    try {
      const durableSnapshot = ownerVerified ? await captureWorkspaceDeletionSnapshot() : null;
      const current = useCloudStore.getState();
      if (current.session?.user.id !== accountId || current.workspaceId !== cloud.workspaceId) {
        if (current.session?.user.id === accountId) setError('The workspace changed. Nothing was deleted.');
        return;
      }

      const result = await cloud.deleteAccount(email, accountId);
      if (!result.ok) {
        if (useCloudStore.getState().session?.user.id === accountId) setError(result.message);
        return;
      }

      // Only the account-specific namespace is safe if auth moved on. Never
      // clear a global snapshot or an untagged key for a newly signed-in user.
      const canClearActive = () =>
        Boolean(
          result.deviceSessionCleared &&
          !useCloudStore.getState().session &&
          !readAuthStorage(authStorageKey()) &&
          ownerVerified &&
          readRecordsOwner() === departingOwner,
        );
      const safeToClearActive = canClearActive();
      let snapshotCleared = !ownerVerified;
      if (safeToClearActive && durableSnapshot) {
        // Capture before the request; atomically compare the IndexedDB value
        // before removing it. A workspace opened during this request survives.
        snapshotCleared = await clearCapturedWorkspaceDeletion(durableSnapshot, canClearActive);
      }
      if (snapshotCleared && canClearActive()) useXbarStore.getState().resetWorkspace();
      const accountFiles = await clearLocalFileVault(
        accountOwner,
        snapshotCleared && canClearActive() && departingOwner === accountOwner ? fileKeys : [],
      );
      const workspaceFiles =
        snapshotCleared && canClearActive() && departingOwner !== accountOwner
          ? await clearLocalFileVault(departingOwner, fileKeys)
          : { cleared: true };
      const cleared =
        result.deviceSessionCleared &&
        (!ownerVerified || safeToClearActive) &&
        snapshotCleared &&
        accountFiles.cleared &&
        workspaceFiles.cleared;
      const currentAccount = useCloudStore.getState().session?.user.id;
      if (currentAccount && currentAccount !== accountId) return;
      pushToast({
        title: cleared ? 'Account deleted' : 'Account deleted; device cleanup needs attention',
        message: cleared
          ? result.message
          : `${result.message} Some device cleanup could not be confirmed. Reopen XBAR to check the current session.`,
        tone: cleared && !result.incomplete ? 'success' : 'warning',
      });
      if (result.deviceSessionCleared && !useCloudStore.getState().session) navigate('/login', { replace: true });
    } catch {
      setError('This device could not confirm the result. Check the account status before trying again.');
    } finally {
      submitLock.current = false;
      activeRequests.delete(accountId);
      setDeleting(false);
      onBusyChange?.(false);
    }
  }

  const explanation = (
    <p className="settings-danger-note">
      Deleting your account removes your login and permanently erases every workspace you solely own. If you own a
      workspace with other members, deletion is blocked until a reviewed ownership handoff protects its records and
      files.
    </p>
  );
  const controls = (
    <div className="settings-danger-confirm">
      <label className="field">
        <span className="field__label">Type your email to confirm</span>
        <input
          className="field-input"
          type="email"
          autoComplete="off"
          spellCheck={false}
          placeholder={accountEmail}
          value={email}
          disabled={deleting || disabled}
          onChange={(event) => setConfirmation({ accountId, email: event.target.value })}
        />
      </label>
      <button
        className="button button--danger button--compact"
        type="button"
        onClick={() => void performDeletion()}
        disabled={!confirmed || deleting || disabled}
      >
        {deleting ? 'Deleting…' : 'Permanently delete my account'}
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );

  if (compact) {
    return (
      <details>
        <summary>Delete account</summary>
        {explanation}
        {controls}
      </details>
    );
  }
  return (
    <Panel
      eyebrow="Danger zone"
      title="Delete account"
      description="Permanently delete your XBAR account and the data you own. This cannot be undone."
    >
      {explanation}
      {controls}
    </Panel>
  );
}
