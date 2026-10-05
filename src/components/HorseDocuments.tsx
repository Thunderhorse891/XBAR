import { readRecordsOwner } from '@/lib/recordsOwner';
import { vaultOwnerId } from '@/lib/vaultOwner';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DocumentLibrary } from '@/components/DocumentLibrary';
import { ActionButton } from '@/components/saas';
import { openStoredFileInTab } from '@/lib/openStoredFile';
import { downloadStoredFile } from '@/lib/downloadStoredFile';
import { documentWithFreshSource, documentIdentityCacheNeedsReview } from '@/lib/ownershipDocumentReview';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import type { HorseRecord, DocumentRecord } from '@/types/xbar';

export function HorseDocuments({ horse }: { horse: HorseRecord }) {
  const navigate = useNavigate();
  const allDocuments = useXbarStore((s) => s.documents);
  const canUpload = useCurrentRoleCapability('uploadDocuments');
  const pushToast = useUiStore((s) => s.pushToast);
  const [busyId, setBusyId] = useState('');
  const pending = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const documents = allDocuments
    .filter((doc) => doc.horseId === horse.id || (!doc.horseId && horse.documents.includes(doc.id)))
    .map((doc) => {
      const source = documentWithFreshSource(doc);
      return doc.state === 'Ready' &&
        (doc.identityReviewRequired || source.identityReviewRequired || documentIdentityCacheNeedsReview(doc, horse))
        ? { ...source, state: 'Needs Review' as const }
        : source;
    });
  const open = async (doc: DocumentRecord, download: boolean) => {
    if (pending.current) return;
    pending.current = true;
    setBusyId(doc.id);
    const state = useXbarStore.getState();
    const original = state.documents.find((item) => item.id === doc.id);
    const cloud = useCloudStore.getState();
    const recordedOwner = readRecordsOwner();
    const owner = vaultOwnerId();
    const contextReady = () => {
      const current = useCloudStore.getState();
      const recorded = readRecordsOwner();
      if (recorded && recorded !== vaultOwnerId()) return false;
      return (
        !(isSupabaseConfigured() || current.session || current.workspaceId) ||
        Boolean(recorded && current.session?.user.id && current.workspaceReady && current.autosaveReady)
      );
    };
    const sameContext = () => {
      const current = useCloudStore.getState();
      const records = useXbarStore.getState();
      return (
        contextReady() &&
        readRecordsOwner() === recordedOwner &&
        vaultOwnerId() === owner &&
        current.workspaceId === cloud.workspaceId &&
        current.session?.user.id === cloud.session?.user.id &&
        current.workspaceRole === cloud.workspaceRole &&
        records.currentRole === state.currentRole &&
        records.workspaceProfile === state.workspaceProfile &&
        records.documents.find((item) => item.id === doc.id) === original
      );
    };
    let invalidated = false;
    const reconcile = () => {
      if (!sameContext()) invalidated = true;
    };
    const unsubscribeCloud = useCloudStore.subscribe(reconcile);
    const unsubscribeRecords = useXbarStore.subscribe(reconcile);
    const isCurrent = () => {
      reconcile();
      return alive.current && !invalidated;
    };
    try {
      if (!contextReady()) {
        pushToast({
          title: 'Ranch still loading',
          message: 'Wait for this ranch to finish loading before opening its documents.',
          tone: 'error',
        });
        return;
      }
      if (
        !original ||
        ['fileUrl', 'storagePath', 'localFileKey', 'horseId'].some(
          (field) => original[field as keyof DocumentRecord] !== doc[field as keyof DocumentRecord],
        )
      ) {
        pushToast({
          title: 'File changed',
          message: 'Open this document again before downloading its original.',
          tone: 'error',
        });
        return;
      }
      const result = download
        ? await downloadStoredFile(original, isCurrent)
        : await openStoredFileInTab(original, isCurrent);
      if (alive.current && !result.ok) pushToast({ title: 'File unavailable', message: result.message, tone: 'error' });
    } finally {
      unsubscribeCloud();
      unsubscribeRecords();
      pending.current = false;
      if (alive.current) setBusyId('');
    }
  };
  return (
    <>
      {canUpload ? (
        <div className="inline-actions" style={{ marginBottom: 12 }}>
          <ActionButton
            onClick={() =>
              navigate(`/documents?${new URLSearchParams({ horse: horse.id, from: 'profile', upload: '1' })}`)
            }
          >
            Upload document for {horse.name}
          </ActionButton>
        </div>
      ) : null}
      <DocumentLibrary
        documents={documents}
        horses={[horse]}
        openingDocumentId={busyId}
        onOpen={(doc) => void open(doc, false)}
        onDownload={(doc) => void open(doc, true)}
        onReview={(doc) =>
          navigate(
            `/documents?${new URLSearchParams({ horse: horse.id, from: 'profile', stage: doc.state === 'Ready' ? 'Proof' : doc.state === 'Queued' ? 'Processing' : 'Review' })}`,
          )
        }
      />
    </>
  );
}
