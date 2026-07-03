import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileText, Plus, Upload } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { SalePacketWizard } from '@/components/SalePacketWizard';
import { useXbarStore } from '@/store/useXbarStore';
import type { DocumentType } from '@/types/xbar';

const REQUIRED = [
  { id: 'coggins', label: 'Coggins (negative)' },
  { id: 'health', label: 'Health certificate' },
  { id: 'registration', label: 'Registration papers' },
  { id: 'bos', label: 'Bill of sale' },
  { id: 'photos', label: 'Sale photos' },
];

// Map a stored document type onto the required-document slot it satisfies.
const DOC_TYPE_TO_REQ: Partial<Record<DocumentType, string>> = {
  Coggins: 'coggins',
  'Vet Record': 'health',
  Registration: 'registration',
  'Bill of Sale': 'bos',
  'Media Kit': 'photos',
};

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function SalePacketStudio() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const horses = useXbarStore((s) => s.horses);
  const documents = useXbarStore((s) => s.documents);
  const salePacketBuilds = useXbarStore((s) => s.salePacketBuilds);
  // ?horse= lets Buyer Follow-up (and horse records) open the builder with
  // that horse preselected so the packet flow keeps its buyer context.
  const requestedHorseId = params.get('horse');
  const [wizardHorseId, setWizardHorseId] = useState<string | null>(requestedHorseId);
  const [wizardOpen, setWizardOpen] = useState<boolean>(Boolean(requestedHorseId));

  const readiness = useMemo(
    () =>
      horses.map((horse) => {
        const readyDocs = documents.filter((d) => d.horseId === horse.id && d.state === 'Ready');
        const presentSlots = new Set(readyDocs.map((d) => DOC_TYPE_TO_REQ[d.type]).filter(Boolean));
        const missing = REQUIRED.filter((slot) => !presentSlots.has(slot.id));
        const blockers = horse.readiness?.blockers ?? [];
        const state: 'Ready' | 'Needs Review' | 'Blocked' = blockers.length ? 'Blocked' : missing.length ? 'Needs Review' : 'Ready';
        return { horse, readyDocs, missing, blockers, state };
      }),
    [horses, documents],
  );

  const readyCount = readiness.filter((r) => r.state === 'Ready').length;
  const blockedCount = readiness.filter((r) => r.state === 'Blocked').length;

  const openWizard = (horseId?: string) => {
    setWizardHorseId(horseId ?? null);
    setWizardOpen(true);
  };

  if (!horses.length) {
    return (
      <>
        <PageHead eyebrow="Selling" title="Sale Packets" subtitle="Build a watermarked packet from approved documents and share it with a buyer." />
        <Card>
          <div className="xs-empty">
            <span className="xs-empty__icon"><FileText size={26} /></span>
            <div className="xs-empty__title">No horses to prepare yet</div>
            <div className="xs-empty__sub">Add a horse and its documents, then build a sale packet from the approved records.</div>
            <ActionButton variant="primary" onClick={() => navigate('/horses?new=1')}>Add first horse</ActionButton>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHead
        eyebrow="Selling"
        title="Sale Packets"
        subtitle={`${readyCount} of ${horses.length} horses have every required document approved${blockedCount ? ` · ${blockedCount} blocked` : ''}.`}
        actions={<ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => openWizard()}>Build packet</ActionButton>}
      />

      <Card title="Horse readiness" >
        <div className="xs-mlist">
          {readiness.map(({ horse, missing, blockers, state, readyDocs }) => (
            <div key={horse.id} className="xs-mrow">
              <span className="xs-mrow__main" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="xs-mrow__title">{horse.name}</span>
                <span className="xs-mrow__meta">
                  {readyDocs.length} approved document{readyDocs.length === 1 ? '' : 's'}
                  {blockers.length ? ` · ${blockers[0]}` : missing.length ? ` · missing: ${missing.map((m) => m.label).join(', ')}` : ' · all required documents approved'}
                </span>
              </span>
              <StatusChip tone={state === 'Ready' ? 'success' : state === 'Needs Review' ? 'warning' : 'danger'}>{state}</StatusChip>
              {state === 'Blocked' ? (
                <ActionButton size="sm" onClick={() => navigate(`/horses/${horse.id}`)}>Fix on record</ActionButton>
              ) : state === 'Needs Review' ? (
                <ActionButton size="sm" icon={<Upload size={14} />} onClick={() => navigate(`/documents?upload=1&horse=${horse.id}`)}>Upload</ActionButton>
              ) : null}
              <ActionButton size="sm" variant="primary" onClick={() => openWizard(horse.id)}>Build packet</ActionButton>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Generated packets" >
        {salePacketBuilds.length ? (
          <div className="xs-mlist">
            {salePacketBuilds.map((packet) => {
              const horse = horses.find((h) => h.id === packet.horseId);
              return (
                <div key={packet.id} className="xs-mrow">
                  <span className="xs-mrow__main" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span className="xs-mrow__title">{horse?.name ?? 'Horse record removed'} · {formatDate(packet.createdAt)}</span>
                    <span className="xs-mrow__meta">
                      {packet.documentIds.length} document{packet.documentIds.length === 1 ? '' : 's'}
                      {packet.includesBillOfSale ? ' + Bill of Sale' : ''}
                      {packet.buyerName ? ` · for ${packet.buyerName}` : ''}
                      {` · watermark "${packet.watermark}"`}
                    </span>
                  </span>
                  <StatusChip tone={packet.status === 'shared' ? 'info' : 'success'}>{packet.status === 'shared' ? 'Shared' : 'Generated'}</StatusChip>
                  {packet.downloadUrl ? (
                    <a className="xs-btn xs-btn--sm" href={packet.downloadUrl} download={packet.fileName}>Download</a>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="xs-muted" style={{ fontSize: 13, margin: 0 }}>
            No packets yet. Build one from a horse with approved documents — the packet is watermarked, logged, and saved here.
          </p>
        )}
      </Card>

      <SalePacketWizard
        open={wizardOpen}
        initialHorseId={wizardHorseId}
        onClose={() => { setWizardOpen(false); setWizardHorseId(null); }}
      />
    </>
  );
}
