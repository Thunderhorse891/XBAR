import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { FileText, Plus } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { SalePacketWizard } from '@/components/SalePacketWizard';
import { SavedPacketDownload } from '@/components/SavedPacketDownload';
import { useXbarStore } from '@/store/useXbarStore';
import { useUiStore } from '@/store/useUiStore';
import { openStoredFileInTab } from '@/lib/openStoredFile';
import type { SalePacketBuild } from '@/types/xbar';
import { isNavigableFileUrl } from '@/lib/navigableFileUrl';
import { buildSaleReadinessScore } from '@/lib/saleReadinessScore';
import { packetReadinessAction } from '@/lib/salePacketGuidance';
import { buildBuyerPacketReleaseGate } from '@/lib/buyerPacketReleaseGate';
import { isBuyerSafeDocumentType } from '@/lib/localSalePacketGenerator';
import { useDayKey } from '@/hooks/useDayKey';
import './salePacketStudio.css';

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function SalePacketStudio() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const horses = useXbarStore((s) => s.horses);
  const documents = useXbarStore((s) => s.documents);
  const salePacketBuilds = useXbarStore((s) => s.salePacketBuilds);
  const expenseReceipts = useXbarStore((s) => s.expenseReceipts);
  const ownershipRecords = useXbarStore((s) => s.ownershipRecords);
  // ?horse= lets Buyer Follow-up (and horse records) open the builder with
  // that horse preselected so the packet flow keeps its buyer context.
  const requestedHorseId = params.get('horse');
  const [wizardHorseId, setWizardHorseId] = useState<string | null>(requestedHorseId);
  const [wizardOpen, setWizardOpen] = useState<boolean>(Boolean(requestedHorseId));
  const [openingPacketId, setOpeningPacketId] = useState('');
  const pushToast = useUiStore((state) => state.pushToast);
  const dayKey = useDayKey();

  const openPacket = async (packet: SalePacketBuild) => {
    setOpeningPacketId(packet.id);
    const result = await openStoredFileInTab(packet);
    setOpeningPacketId('');

    if (!result.ok) {
      pushToast({ title: 'Packet unavailable', message: result.message, tone: 'error' });
    }
  };

  const readiness = useMemo(
    () =>
      horses.map((horse) => {
        const readyDocs = documents.filter(
          (d) => d.horseId === horse.id && d.state === 'Ready' && isBuyerSafeDocumentType(d.type),
        );
        // Preserve the established computed readiness thresholds and release
        // checks. Packet preparation can retain required disclosures while the
        // readiness review still identifies incomplete source records.
        const ownershipRecord = ownershipRecords.find((record) => record.horseId === horse.id);
        const releaseGate = buildBuyerPacketReleaseGate({
          horse,
          documents: documents.filter((document) => document.horseId === horse.id),
          ownershipRecord,
        });
        const score = buildSaleReadinessScore({
          horse,
          documents,
          receipts: expenseReceipts,
          ownershipRecord,
          releaseGate,
        });
        const blockers = score.proofPacketBlocker ? [score.proofPacketBlocker] : [];
        const displayedBlocker = releaseGate.blockers[0] ?? score.actions[0]?.label;
        const state: 'Ready' | 'Blocked' = score.proofPacketReady ? 'Ready' : 'Blocked';
        const repairs = [
          ...score.actions.map((action) => ({ reason: action.label, ...packetReadinessAction(action, horse.id) })),
          ...releaseGate.remediations,
        ];
        return { horse, readyDocs, blockers, displayedBlocker, score: score.score, state, repairs };
      }),
    // Both assessments read date-sensitive care and document expiry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [horses, documents, expenseReceipts, ownershipRecords, dayKey],
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
        <PageHead
          eyebrow="Selling"
          title="Sale Packets"
          subtitle="Build a watermarked packet from approved documents and share it with a buyer."
        />
        <Card>
          <div className="xs-empty">
            <span className="xs-empty__icon">
              <FileText size={26} />
            </span>
            <div className="xs-empty__title">No horses to prepare yet</div>
            <div className="xs-empty__sub">
              Add a horse and its documents, then build a sale packet from the approved records.
            </div>
            <ActionButton variant="primary" onClick={() => navigate('/horses?new=1')}>
              Add first horse
            </ActionButton>
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
        subtitle={`${readyCount} of ${horses.length} horses have complete readiness checks${blockedCount ? ` · ${blockedCount} need review` : ''}.`}
        actions={
          <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => openWizard()}>
            Build packet
          </ActionButton>
        }
      />

      <p className="xs-muted">
        Prepare a packet from the records you choose. Review outstanding checks and the packet's disclosures before
        sharing.
      </p>
      <Card title="Readiness review">
        <div className="xs-mlist">
          {readiness.map(({ horse, blockers, displayedBlocker, score, state, readyDocs, repairs }) => (
            <div key={horse.id} className="xs-mrow sale-packet-row">
              <span className="xs-mrow__main" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span className="xs-mrow__title">{horse.name}</span>
                <span className="xs-mrow__meta">
                  {readyDocs.length} reviewed buyer record{readyDocs.length === 1 ? '' : 's'} · Readiness {score}/100
                </span>
                {blockers.length && displayedBlocker ? <span className="xs-mrow__meta">{displayedBlocker}</span> : null}
              </span>
              <StatusChip tone={state === 'Ready' ? 'success' : 'danger'}>
                {state === 'Ready' ? 'Checks complete' : 'Needs review'}
              </StatusChip>
              {state === 'Blocked' ? (
                <details style={{ maxWidth: 360 }}>
                  <summary className="xs-btn xs-btn--sm">What needs fixing ({repairs.length})</summary>
                  <ul style={{ margin: '8px 0', paddingLeft: 18 }} aria-label={`Packet requirements for ${horse.name}`}>
                    {repairs.map((repair, index) => (
                      <li key={`${repair.reason}-${index}`} style={{ marginBottom: 10 }}>
                        <div>{repair.reason}</div>
                        <ActionButton size="sm" onClick={() => navigate(repair.to)}>
                          {repair.label}
                        </ActionButton>
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              <ActionButton size="sm" variant="primary" onClick={() => openWizard(horse.id)}>
                Build packet
              </ActionButton>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Generated packets">
        {salePacketBuilds.length ? (
          <div className="xs-mlist">
            {salePacketBuilds.map((packet) => {
              const horse = horses.find((h) => h.id === packet.horseId);
              return (
                <div key={packet.id} className="xs-mrow sale-packet-row">
                  <span className="xs-mrow__main" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span className="xs-mrow__title">
                      {horse?.name ?? 'Horse record removed'} · {formatDate(packet.createdAt)}
                    </span>
                    <span className="xs-mrow__meta">
                      {packet.documentIds.length} document{packet.documentIds.length === 1 ? '' : 's'}
                      {packet.includesBillOfSale ? ' + Bill of Sale' : ''}
                      {packet.buyerName ? ` · for ${packet.buyerName}` : ''}
                      {` · watermark "${packet.watermark}"`}
                    </span>
                  </span>
                  <StatusChip tone={packet.status === 'shared' ? 'info' : 'success'}>
                    {packet.status === 'shared' ? 'Shared' : 'Generated'}
                  </StatusChip>
                  {/* Scheme-checked: an imported packet's downloadUrl is untrusted, and
                      `download` does not stop a browser running a `javascript:` href. */}
                  {isNavigableFileUrl(packet.downloadUrl) ? (
                    <a className="xs-btn xs-btn--sm" href={packet.downloadUrl} download={packet.fileName}>
                      Download
                    </a>
                  ) : packet.localFileKey ? (
                    // Generated in the browser and kept in this device's vault.
                    // Its address is created on demand: an object URL saved at
                    // generation time is dead by the next page load, which is
                    // when a seller comes back to this list to send the packet.
                    <button
                      className="xs-btn xs-btn--sm"
                      type="button"
                      onClick={() => void openPacket(packet)}
                      disabled={openingPacketId === packet.id}
                    >
                      {openingPacketId === packet.id ? 'Opening...' : 'Open'}
                    </button>
                  ) : null}
                  {packet.localFileKey ? <SavedPacketDownload packet={packet} className="xs-btn xs-btn--sm" /> : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="xs-muted" style={{ fontSize: 13, margin: 0 }}>
            No packets yet. Build one from a horse with approved documents — the packet is watermarked, logged, and
            saved here.
          </p>
        )}
      </Card>

      <SalePacketWizard
        open={wizardOpen}
        initialHorseId={wizardHorseId}
        onClose={() => {
          setWizardOpen(false);
          setWizardHorseId(null);
          if (params.has('horse') || params.has('resume')) {
            const next = new URLSearchParams(params);
            next.delete('horse');
            next.delete('resume');
            setParams(next, { replace: true });
          }
        }}
      />
    </>
  );
}
