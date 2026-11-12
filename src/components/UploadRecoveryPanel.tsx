import { useEffect, useState } from 'react';
import { Panel, Pill } from '@/components/app-ui';
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { cloudUploadDependencies } from '@/lib/cloudWorkspace';
import { listReservedUploadRecovery } from '@/lib/reservedUploadJournal';
import {
  cancelReservedUpload,
  checkReservedUpload,
  recoveryCanCancel,
  type UploadIdentity,
  type UploadRecovery,
} from '@/lib/reservedUploadClient';
import { useCloudStore } from '@/store/useCloudStore';

function RecoveryList({ target }: { target: UploadIdentity }) {
  const [records, setRecords] = useState<UploadRecovery[]>([]);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [cancel, setCancel] = useState<UploadRecovery | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const stillHere = () => {
    const cloud = useCloudStore.getState();
    return cloud.session?.user.id === target.userId && cloud.workspaceId === target.workspaceId;
  };
  const refresh = () => {
    if (!stillHere()) return;
    try {
      setRecords(listReservedUploadRecovery(target).filter((r) => r.state !== 'aborted' && r.state !== 'not_started'));
    } catch {
      setNotice(
        'Upload recovery metadata could not be read on this device. Keep your originals and contact support if an upload is pending.',
      );
    }
  };
  useEffect(() => {
    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener('xbar-upload-recovery', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('xbar-upload-recovery', refresh);
    };
    // This component is keyed by account/workspace and remounts on either change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function act(record: UploadRecovery, action: 'status' | 'abort') {
    if (busy || !stillHere()) return;
    setBusy(record.requestId);
    setNotice('');
    try {
      const deps = cloudUploadDependencies(record.kind);
      if (action === 'abort') {
        await cancelReservedUpload(record.requestId, target, deps);
        if (stillHere())
          setNotice(
            'Incomplete upload cancelled. Completed originals were not removed. Keep or reselect your original before uploading again.',
          );
      } else {
        const result = await checkReservedUpload(record.requestId, target, deps);
        if (stillHere())
          setNotice(
            result.state === 'completed'
              ? `Cloud original confirmed at ${result.storagePath}. No record was linked automatically. If the file is missing from its record, contact support with recovery ID ${record.requestId}.`
              : result.state === 'not_started'
                ? 'No reservation was created. You can select the original and start a new upload.'
                : result.state === 'aborted'
                  ? 'Cancellation is confirmed. The original was not deleted from this device.'
                  : recoveryCanCancel(result)
                    ? 'The upload is incomplete. You can cancel its unfinished parts before starting again.'
                    : `The outcome is still pending and storage remains reserved. Contact support with recovery ID ${record.requestId}; do not re-upload or cancel an uncertain completion.`,
          );
      }
    } catch (error) {
      if (stillHere())
        setNotice(
          error instanceof Error
            ? error.message
            : 'The upload outcome could not be checked. Keep the original and contact support.',
        );
    } finally {
      if (stillHere()) {
        setBusy('');
        refresh();
      }
    }
  }
  if (!records.length && !notice) return null;
  return (
    <Panel
      style={{ minWidth: 0, overflowWrap: 'anywhere' }}
      eyebrow="Storage recovery"
      title="Unfinished uploads"
      description="These uploads belong to this account and ranch. Pending storage stays reserved until the server confirms the outcome."
    >
      {notice && (
        <p className="settings-danger-note" role="status">
          {notice}
        </p>
      )}
      {records.some((record) => record.state === 'completed') && (
        <button
          className="button button--ghost button--compact"
          type="button"
          onClick={() => setShowCompleted((value) => !value)}
        >
          {showCompleted ? 'Hide confirmed uploads' : 'Show confirmed uploads'}
        </button>
      )}
      <div className="stack-list">
        {records
          .filter((record) => showCompleted || record.state !== 'completed' || record.requiresReview)
          .map((record) => (
            <div className="stack-item" key={record.requestId}>
              <div className="stack-item__title">{record.fileName}</div>
              <Pill tone="blue">
                {record.state === 'completed'
                  ? 'Original confirmed'
                  : record.state === 'uploading'
                    ? 'Incomplete upload'
                    : 'Needs status check'}
              </Pill>
              <p>Recovery ID: {record.requestId}</p>
              {record.state === 'completed' && (
                <p>
                  If this original is missing from its record, contact support with this recovery ID. Nothing is linked
                  automatically.
                </p>
              )}
              {record.storagePath && <p>Storage path: {record.storagePath}</p>}
              <p>
                {record.originalRetention === 'device'
                  ? 'A recovery copy was saved on this device.'
                  : 'Keep the original. After cancellation, select it again to start a new upload.'}
              </p>
              {record.completionStarted && record.state !== 'completed' && (
                <p>
                  Completion has started or is uncertain. Check status; if it remains pending, support must reconcile
                  it.
                </p>
              )}
              <div className="inline-actions">
                <button
                  className="button button--ghost button--compact"
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void act(record, 'status')}
                >
                  Check status
                </button>
                {recoveryCanCancel(record) && (
                  <button
                    className="button button--ghost button--compact"
                    type="button"
                    disabled={Boolean(busy)}
                    onClick={() => setCancel(record)}
                  >
                    Cancel incomplete upload
                  </button>
                )}
              </div>
            </div>
          ))}
      </div>
      <ConfirmActionDialog
        open={Boolean(cancel)}
        title="Cancel incomplete upload"
        consequences={[
          'This stops and removes only unfinished upload parts after the server verifies cancellation is safe.',
          'It never removes a completed original or a file already attached to a record.',
          'Keep your original file. Start again only after cancellation is confirmed.',
        ]}
        acknowledgements={['I want to stop this incomplete upload.']}
        confirmLabel="Cancel incomplete upload"
        onCancel={() => setCancel(null)}
        onConfirm={() => {
          const selected = cancel;
          setCancel(null);
          if (selected) void act(selected, 'abort');
        }}
      />
    </Panel>
  );
}

export function UploadRecoveryPanel() {
  const userId = useCloudStore((state) => state.session?.user.id);
  const workspaceId = useCloudStore((state) => state.workspaceId);
  if (!userId || !workspaceId) return null;
  return <RecoveryList key={`${userId}:${workspaceId}`} target={{ userId, workspaceId }} />;
}
