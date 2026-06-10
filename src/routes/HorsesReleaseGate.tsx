import { Link, useNavigate } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { SalePacketSlots } from '@/components/SalePacketSlots';
import { Pill, ProgressBar } from '@/components/app-ui';
import { buildBuyerPacketReleaseGate } from '@/lib/buyerPacketReleaseGate';
import { buildPublicShareUrl } from '@/lib/facebookSharing';
import { formatCompactCurrency } from '@/lib/format';
import { buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';

export default function HorsesReleaseGate() {
  const navigate = useNavigate();
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const sharedListings = useXbarStore((state) => state.sharedListings);
  const toggleSharedListing = useXbarStore((state) => state.toggleSharedListing);
  const recordSharedChannel = useXbarStore((state) => state.recordSharedChannel);
  const pushToast = useUiStore((state) => state.pushToast);
  const openRightDrawer = useUiStore((state) => state.openRightDrawer);
  const canManageSharedAccess = useCurrentRoleCapability('manageSharedAccess');

  const getHorseDocuments = (horseId: string) => documents.filter((document) => document.horseId === horseId);
  const getOwnershipRecord = (horseId: string) => ownershipRecords.find((record) => record.horseId === horseId);
  const getListing = (horseId: string) => sharedListings.find((listing) => listing.horseId === horseId && listing.state !== 'Archived');

  const commandFiles = horses.map((horse) => {
    const horseDocuments = getHorseDocuments(horse.id);
    const ownershipRecord = getOwnershipRecord(horse.id);
    const packet = buildHorsePacketCompleteness(horse, horseDocuments, ownershipRecord);
    const gate = buildBuyerPacketReleaseGate({ horse, documents: horseDocuments, ownershipRecord });
    const listing = getListing(horse.id);
    return { horse, horseDocuments, packet, gate, listing };
  });

  const releaseClear = commandFiles.filter((file) => file.gate.allowed).length;
  const releaseBlocked = commandFiles.filter((file) => !file.gate.allowed).length;
  const careHolds = horses.filter((horse) => horse.status === 'Medical Review').length;
  const totalBlockers = commandFiles.reduce((sum, file) => sum + file.gate.blockers.length, 0);

  const openGateReview = (file: (typeof commandFiles)[number]) => {
    openRightDrawer({
      id: `release-gate-${file.horse.id}`,
      eyebrow: 'Buyer Packet Release Gate',
      title: file.horse.name,
      description: file.gate.summary,
      facts: [
        { label: 'Release status', value: file.gate.status },
        { label: 'Gate score', value: `${file.gate.score}` },
        { label: 'Blockers', value: `${file.gate.blockers.length}` },
        { label: 'Next action', value: file.gate.nextAction },
      ],
      actions: [
        { label: 'Open command file', path: `/horses/${file.horse.id}` },
        { label: 'Open Proof Vault', path: '/documents' },
        { label: 'Open Title & Transfer', path: '/ownership' },
        { label: 'Open Care Status', path: '/medical' },
      ],
    });
  };

  const releasePacket = async (file: (typeof commandFiles)[number]) => {
    if (file.listing) {
      const result = await toggleSharedListing(file.horse.id);
      pushToast({
        title: result.ok ? 'Buyer packet held' : 'Hold blocked',
        message: result.ok ? `${file.horse.name} was removed from buyer access.` : result.message,
        tone: result.ok ? 'warning' : 'error',
      });
      return;
    }

    if (!file.gate.allowed) {
      pushToast({
        title: 'Buyer packet release blocked',
        message: `${file.gate.summary} Next: ${file.gate.nextAction}`,
        tone: 'error',
      });
      openGateReview(file);
      return;
    }

    const result = await toggleSharedListing(file.horse.id);
    pushToast({
      title: result.ok ? 'Buyer packet released' : 'Release blocked',
      message: result.ok ? `${file.horse.name} cleared the release gate and is now staged for buyer access.` : result.message,
      tone: result.ok ? 'success' : 'error',
    });
  };

  const openBuyerPacket = async (file: (typeof commandFiles)[number]) => {
    if (!file.listing) {
      await releasePacket(file);
      return;
    }

    await recordSharedChannel(file.horse.id, 'Direct Link');
    const url = buildPublicShareUrl(file.packet.sharePath, file.listing.accessMode === 'Private Token' ? file.listing.shareToken : undefined);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <div className="surface-hero surface-hero--dark command-files-hero">
        <div className="surface-hero__top">
          <div>
            <span className="surface-hero__eyebrow">Command Files</span>
            <h1>Buyer packets now release only when the file clears proof, title, and care gates.</h1>
            <p className="command-center-briefing__copy">
              This surface is no longer a passive card list. Each horse is evaluated against a release gate before buyer access can be staged.
            </p>
          </div>
          <div className="surface-hero__stats">
            <div className="surface-hero__stat"><span>Command files</span><strong>{horses.length}</strong></div>
            <div className="surface-hero__stat"><span>Release clear</span><strong style={{ color: 'var(--emerald)' }}>{releaseClear}</strong></div>
            <div className="surface-hero__stat"><span>Release blocked</span><strong style={{ color: releaseBlocked ? 'var(--rose)' : 'var(--emerald)' }}>{releaseBlocked}</strong></div>
            <div className="surface-hero__stat"><span>Open blockers</span><strong style={{ color: totalBlockers ? 'var(--amber)' : 'var(--emerald)' }}>{totalBlockers}</strong></div>
          </div>
        </div>
      </div>

      <section className="panel">
        <div className="panel__header">
          <div>
            <div className="panel__eyebrow">Release Control</div>
            <h2 className="panel__title">Proof-gated buyer packet queue</h2>
            <p className="panel__description">Stage packet is now a controlled release action. Blocked files show the exact next action.</p>
          </div>
          <div className="status-inline"><Pill tone={careHolds ? 'rose' : 'emerald'}>{careHolds} care holds</Pill><Pill tone={releaseBlocked ? 'amber' : 'emerald'}>{releaseBlocked} blocked</Pill></div>
        </div>
      </section>

      {commandFiles.length ? (
        <div className="horse-grid">
          {commandFiles.map((file) => {
            const value = file.horse.sale.askPrice || file.horse.insuredValue;
            return (
              <article key={file.horse.id} className="horse-card">
                <div className="horse-card__body">
                  <div className="stack-item__top">
                    <div>
                      <div className="horse-card__kicker">{file.horse.segment}</div>
                      <h2 className="horse-card__title" style={{ color: '#07101a' }}>{file.horse.name}</h2>
                      <div className="horse-card__subtitle" style={{ color: '#566473' }}>{file.horse.owner} · {file.horse.location.barn}</div>
                    </div>
                    <Pill tone={file.gate.tone}>{file.listing ? 'Released' : file.gate.status}</Pill>
                  </div>

                  <div className="horse-card__metric-band">
                    <div className="horse-card__metric"><span>Gate score</span><strong>{file.gate.score}</strong></div>
                    <div className="horse-card__metric"><span>Value</span><strong>{formatCompactCurrency(value)}</strong></div>
                    <div className="horse-card__metric"><span>Blockers</span><strong>{file.gate.blockers.length}</strong></div>
                  </div>

                  <div className="horse-card__readiness">
                    <div className="horse-card__readiness-head"><span>Buyer release gate</span><strong>{file.gate.status}</strong></div>
                    <ProgressBar value={file.gate.score} tone={file.gate.tone} />
                  </div>

                  <div className="horse-card__facts">
                    <span className="horse-card__fact"><strong>Next action</strong>{file.gate.nextAction}</span>
                    <span className="horse-card__fact"><strong>Documents</strong>{file.horseDocuments.length}</span>
                    <span className="horse-card__fact"><strong>Transfer</strong>{getOwnershipRecord(file.horse.id)?.transferStatus ?? 'No record'}</span>
                  </div>

                  <div className="horse-card__packet">
                    <div className="horse-card__packet-head"><span>Release evidence</span><strong>{file.packet.saleSlots.filter((slot) => slot.status === 'ready').length}/{file.packet.saleSlots.length}</strong></div>
                    <SalePacketSlots slots={file.packet.saleSlots} compact />
                  </div>

                  {file.gate.blockers.length ? (
                    <div className="stack-list" style={{ marginTop: '14px' }}>
                      {file.gate.blockers.slice(0, 3).map((blocker) => <div key={blocker} className="stack-item"><div className="stack-item__copy">{blocker}</div></div>)}
                    </div>
                  ) : null}

                  <div className="horse-card__footer">
                    <div className="status-inline"><Pill tone={file.gate.tone}>{file.gate.allowed ? 'Release clear' : 'Release blocked'}</Pill><span>{file.horse.sale.inquiryCount} inquiries</span></div>
                    <div className="inline-actions inline-actions--card">
                      <button className="button button--ghost button--compact" type="button" onClick={() => openGateReview(file)}>Gate review</button>
                      <button className="button button--ghost button--compact" type="button" onClick={() => void releasePacket(file)} disabled={!canManageSharedAccess}>{file.listing ? 'Hold packet' : file.gate.allowed ? 'Release packet' : 'Run gate'}</button>
                      <button className="button button--primary button--compact" type="button" onClick={() => void openBuyerPacket(file)}>{file.listing ? 'Open packet' : 'Release'}</button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <EmptyState title="No command files yet" description="Create a command file before buyer packet release can be controlled." action={<Link to="/documents?upload=1" className="button button--primary button--compact">Upload proof</Link>} />
      )}
    </>
  );
}
