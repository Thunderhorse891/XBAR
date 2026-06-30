import { type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { XBAR_MAIN_LOGO_SRC } from '@/components/BrandMark';
import { assessRevenueAtRisk } from '@/lib/businessIntelligence';
import { buildBudgetSummary, buildCareBoardRows, buildTransferGapRows } from '@/lib/dashboardOps';
import { formatCompactCurrency, formatCurrency, formatDateLabel } from '@/lib/format';
import { buildHorsePacketCompleteness, type PacketCompleteness } from '@/lib/xbarPhaseTwo';
import { useCurrentRoleWorkspace, useXbarStore } from '@/store/useXbarStore';
import type { HorseRecord, RanchAsset } from '@/types/xbar';
import FirstRunExperience from './FirstRunExperience';
import './dashboardEditorial.css';

type Tone = 'clear' | 'review' | 'hold' | 'quiet';

type HorseReadinessProfile = {
  horse: HorseRecord;
  packet: PacketCompleteness;
  askPrice: number;
  blockers: string[];
};

function getTone(status: PacketCompleteness['buyerProfileStatus']): Tone {
  if (status === 'Live') return 'clear';
  if (status === 'Needs Review') return 'review';
  if (status === 'Blocked') return 'hold';
  return 'quiet';
}

function statusLabel(status: PacketCompleteness['buyerProfileStatus']) {
  if (status === 'Live') return 'Ready to release';
  if (status === 'Needs Review') return 'Review';
  if (status === 'Blocked') return 'Hold';
  return 'Private';
}

function uniqueItems(items: string[]) {
  return [...new Set(items.filter(Boolean))];
}

function serviceTime(asset: RanchAsset) {
  const time = Date.parse(asset.nextService);
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function buildBlockerCopy(profile?: HorseReadinessProfile) {
  if (!profile) return ['Create a horse record to start release checks.'];
  const packetBlockers = profile.packet.requirements
    .filter((requirement) => requirement.status !== 'ready')
    .map((requirement) => requirement.detail);
  return uniqueItems([...profile.blockers, ...packetBlockers]).slice(0, 5);
}

function ModuleStrip({
  title,
  value,
  detail,
  tone,
  to,
}: {
  title: string;
  value: string;
  detail: string;
  tone: Tone;
  to: string;
}) {
  return (
    <Link className={`xbar-module-strip xbar-module-strip--${tone}`} to={to}>
      <span>{title}</span>
      <strong>{value}</strong>
      <em>{detail}</em>
    </Link>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const intakeBatches = useXbarStore((state) => state.intakeBatches);
  const ranchAssets = useXbarStore((state) => state.ranchAssets);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const roleWorkspace = useCurrentRoleWorkspace();

  // A genuinely empty workspace gets the bold first-run welcome instead of a
  // data dashboard full of zeros and red "Hold" chips. Once any real data
  // exists — including documents imported before the first horse — fall through
  // to the live dashboard so that state is never hidden behind the preview.
  const workspaceIsEmpty =
    horses.length === 0 &&
    documents.length === 0 &&
    intakeBatches.length === 0 &&
    expenseReceipts.length === 0 &&
    ranchAssets.length === 0 &&
    salesLeads.length === 0 &&
    ownershipRecords.length === 0;
  if (workspaceIsEmpty) {
    return (
      <FirstRunExperience
        ranchName={workspaceProfile.ranchName || workspaceProfile.businessName || 'XBAR Workspace'}
        roleLabel={roleWorkspace.label}
      />
    );
  }

  const transferGaps = buildTransferGapRows(horses, ownershipRecords, documents);
  const careBoard = buildCareBoardRows(horses, documents, expenseReceipts);
  const budgetSummary = buildBudgetSummary(expenseReceipts);
  const revenueRisk = assessRevenueAtRisk(horses, ownershipRecords, documents);
  const reviewQueue = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Matched');
  const riskyDocuments = documents.filter((document) => document.duplicateRisk !== 'Low' || document.state === 'Needs Review');
  const careDueCount = careBoard.filter((row) => row.signals.some((signal) => signal.status === 'due')).length;
  const activeBuyerCount = salesLeads.filter((lead) => lead.stage !== 'Closed').length;
  const qualifiedBuyerCount = salesLeads.filter((lead) => lead.stage === 'Qualified' || lead.stage === 'Offer').length;
  const assetTimeline = [...ranchAssets]
    .sort((a, b) => serviceTime(a) - serviceTime(b))
    .slice(0, 5);

  const readinessProfiles: HorseReadinessProfile[] = horses.map((horse) => {
    const horseDocuments = documents.filter((document) => document.horseId === horse.id);
    const ownershipRecord = ownershipRecords.find((record) => record.horseId === horse.id);
    const riskItem = revenueRisk.items.find((item) => item.horseId === horse.id);
    const packet = buildHorsePacketCompleteness(horse, horseDocuments, ownershipRecord);
    return {
      horse,
      packet,
      askPrice: horse.sale?.askPrice ?? 0,
      blockers: riskItem?.blockers ?? horse.readiness.blockers,
    };
  });

  const saleProfiles = readinessProfiles
    .filter(({ horse, askPrice, packet }) => (
      askPrice > 0 ||
      horse.status === 'Sale Prep' ||
      horse.sale.listingState === 'Buyer Review' ||
      horse.sale.listingState === 'Market Ready' ||
      packet.buyerProfileStatus !== 'Private'
    ))
    .sort((a, b) => {
      const aBlocked = a.packet.buyerProfileStatus === 'Blocked' ? 1 : 0;
      const bBlocked = b.packet.buyerProfileStatus === 'Blocked' ? 1 : 0;
      return bBlocked - aBlocked || b.askPrice - a.askPrice || b.packet.score - a.packet.score;
    });

  const focusProfile = saleProfiles[0] ?? readinessProfiles[0];
  const focusHorse = focusProfile?.horse;
  const focusPacket = focusProfile?.packet;
  const releaseBlockers = buildBlockerCopy(focusProfile);
  const readinessScore = focusPacket?.score ?? 0;
  const readinessTone = focusPacket ? getTone(focusPacket.buyerProfileStatus) : 'quiet';
  const readySaleCount = readinessProfiles.filter((profile) => profile.packet.buyerProfileStatus === 'Live').length;
  const averageReadiness = readinessProfiles.length
    ? Math.round(readinessProfiles.reduce((sum, profile) => sum + profile.packet.score, 0) / readinessProfiles.length)
    : 0;
  const openOwnershipCount = ownershipRecords.filter((record) => record.transferStatus !== 'Clear').length;
  const readySlotCount = focusPacket?.saleSlots.filter((slot) => slot.status === 'ready').length ?? 0;
  const nextMovePath = releaseBlockers.length && focusHorse
    ? `/horses/${focusHorse.id}`
    : reviewQueue.length
      ? '/documents'
      : openOwnershipCount
        ? '/ownership'
        : '/sales';
  const nextMoveLabel = releaseBlockers[0] ?? 'Prepare the next buyer-ready horse record.';
  const ranchName = workspaceProfile.ranchName || workspaceProfile.businessName || 'XBAR Workspace';
  const hasHorseData = horses.length > 0;

  const moduleStrips = [
    {
      title: 'Sale Readiness',
      value: hasHorseData ? `${averageReadiness}%` : 'Start',
      detail: hasHorseData ? `${readySaleCount} horse${readySaleCount === 1 ? '' : 's'} ready to release` : 'Add the first horse record',
      tone: averageReadiness >= 84 ? 'clear' : averageReadiness >= 60 ? 'review' : hasHorseData ? 'hold' : 'quiet',
      to: focusHorse ? `/horses/${focusHorse.id}` : '/horses?new=1',
    },
    {
      title: 'Release Blockers',
      value: String(revenueRisk.items.length + careDueCount + openOwnershipCount),
      detail: revenueRisk.valueAtRisk ? `${formatCompactCurrency(revenueRisk.valueAtRisk)} held from release` : 'No listed value blocked',
      tone: revenueRisk.items.length || careDueCount || openOwnershipCount ? 'hold' : 'clear',
      to: '/ownership',
    },
    {
      title: 'Buyer-Safe Proof',
      value: focusPacket?.buyerSafe ? 'Clear' : focusPacket ? 'Review' : 'Private',
      detail: focusPacket?.buyerProfileNote ?? 'No buyer packet is active yet',
      tone: focusPacket?.buyerSafe ? 'clear' : focusPacket ? 'review' : 'quiet',
      to: focusHorse ? `/profiles/${focusHorse.id}` : '/sales',
    },
    {
      title: 'Document Risk',
      value: String(riskyDocuments.length),
      detail: reviewQueue.length ? `${reviewQueue.length} document${reviewQueue.length === 1 ? '' : 's'} waiting on review` : 'Document queue is clear',
      tone: riskyDocuments.length ? 'review' : 'clear',
      to: '/documents',
    },
    {
      title: 'Ownership Chain',
      value: String(openOwnershipCount),
      detail: transferGaps[0]?.horseName ? `${transferGaps[0].horseName} needs chain review` : 'Transfer chain clear',
      tone: openOwnershipCount ? 'hold' : 'clear',
      to: '/ownership',
    },
    {
      title: 'Packet Readiness',
      value: focusPacket ? `${readySlotCount}/${focusPacket.saleSlots.length}` : '0/5',
      detail: focusPacket?.trustSummary ?? 'Packet checks begin after a horse is added',
      tone: focusPacket && readySlotCount === focusPacket.saleSlots.length ? 'clear' : focusPacket ? 'review' : 'quiet',
      to: focusHorse ? `/horses/${focusHorse.id}` : '/horses?new=1',
    },
    {
      title: 'Asset Timeline',
      value: String(assetTimeline.length),
      detail: assetTimeline[0] ? `${assetTimeline[0].name} next` : 'No asset schedule yet',
      tone: assetTimeline.some((asset) => asset.condition === 'Attention Required') ? 'hold' : assetTimeline.length ? 'review' : 'quiet',
      to: '/assets',
    },
  ] satisfies Array<{
    title: string;
    value: string;
    detail: string;
    tone: Tone;
    to: string;
  }>;

  return (
    <section className="xbar-editorial-dashboard" aria-labelledby="xbar-dashboard-title">
      <img className="xbar-editorial-dashboard__horse-line" src="/brand/xbar-horse-outline-safe.png" alt="" aria-hidden="true" />
      <div className="xbar-editorial-dashboard__brand" aria-label="XBAR brand">
        <img src={XBAR_MAIN_LOGO_SRC} alt="XBAR logo" className="xbar-editorial-dashboard__logo" />
        <div>
          <span>XBAR</span>
          <strong>{ranchName}</strong>
          <em>{roleWorkspace.label}</em>
        </div>
      </div>

      <main className="xbar-editorial-dashboard__stage">
        <header className="xbar-editorial-dashboard__masthead">
          <div>
            <p>Equine_Training_OS_V4</p>
            <h1 id="xbar-dashboard-title">
              {hasHorseData ? 'Sale readiness, before the horse leaves the barn.' : 'Build sale readiness from the first horse.'}
            </h1>
          </div>
          <div className="xbar-editorial-dashboard__actions">
            <Link to={focusHorse ? `/profiles/${focusHorse.id}` : '/horses?new=1'}>Buyer Packet</Link>
            <Link to="/documents">Documents</Link>
          </div>
        </header>

        <section className={`xbar-readiness-hero xbar-readiness-hero--${readinessTone}`} aria-label="Sale Readiness">
          <div className="xbar-readiness-hero__lead">
            <div>
              <span>Sale Readiness</span>
              <strong>{focusHorse?.name ?? 'No horse selected'}</strong>
              <p>{focusHorse?.summary ?? 'Create the first horse record, then attach ownership, health, and sale documents.'}</p>
            </div>
            <button type="button" onClick={() => navigate(nextMovePath)}>
              {focusHorse ? 'Open Release Work' : 'Add Horse'}
            </button>
          </div>

          <div className="xbar-readiness-hero__body">
            <div className="xbar-readiness-meter" style={{ '--score-angle': `${readinessScore * 3.6}deg` } as CSSProperties}>
              <div className="xbar-readiness-meter__core">
                <span>{readinessScore}</span>
                <em>{focusPacket ? statusLabel(focusPacket.buyerProfileStatus) : 'Private'}</em>
              </div>
            </div>

            <div className="xbar-release-brief">
              <div className="xbar-release-brief__headline">
                <span>Release Blockers</span>
                <strong>{releaseBlockers.length ? `${releaseBlockers.length} open` : 'Clear'}</strong>
              </div>
              <ol>
                {releaseBlockers.slice(0, 4).map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ol>
            </div>
          </div>

          <div className="xbar-readiness-hero__slots" aria-label="Packet readiness checks">
            {(focusPacket?.saleSlots ?? []).map((slot) => (
              <Link key={slot.key} to={focusHorse ? `/horses/${focusHorse.id}` : '/horses?new=1'} className={`xbar-slot xbar-slot--${slot.status}`}>
                <span>{slot.label}</span>
                <strong>{slot.status === 'ready' ? 'Clear' : slot.status === 'review' ? 'Review' : 'Hold'}</strong>
              </Link>
            ))}
            {!focusPacket ? (
              <>
                <span className="xbar-slot xbar-slot--missing"><span>AQHA papers</span><strong>Hold</strong></span>
                <span className="xbar-slot xbar-slot--missing"><span>Transfer papers</span><strong>Hold</strong></span>
                <span className="xbar-slot xbar-slot--missing"><span>Coggins</span><strong>Hold</strong></span>
              </>
            ) : null}
          </div>
        </section>

        <section className="xbar-module-river" aria-label="XBAR modules">
          {moduleStrips.map((module) => (
            <ModuleStrip key={module.title} {...module} />
          ))}
        </section>

        <section className="xbar-transaction-timeline" aria-label="Asset Timeline">
          <div className="xbar-transaction-timeline__header">
            <span>Asset Timeline</span>
            <strong>{assetTimeline.length ? 'Next operating dates' : 'No asset dates yet'}</strong>
          </div>
          <div className="xbar-transaction-timeline__line">
            {assetTimeline.length ? assetTimeline.map((asset) => (
              <Link to="/assets" className="xbar-asset-point" key={asset.id}>
                <span>{formatDateLabel(asset.nextService)}</span>
                <strong>{asset.name}</strong>
                <em>{asset.condition}</em>
              </Link>
            )) : (
              <Link to="/assets" className="xbar-asset-point xbar-asset-point--empty">
                <span>Next</span>
                <strong>Add ranch assets</strong>
                <em>Track service, assignment, and sale prep support.</em>
              </Link>
            )}
          </div>
        </section>
      </main>

      <aside className="xbar-intelligence-rail-v2" aria-label="Intelligence rail">
        <div className="xbar-intelligence-rail-v2__inner">
          <div className="xbar-intelligence-rail-v2__brand">
            <img src={XBAR_MAIN_LOGO_SRC} alt="" aria-hidden="true" />
            <div>
              <span>Intelligence</span>
              <strong>{statusLabel(focusPacket?.buyerProfileStatus ?? 'Private')}</strong>
            </div>
          </div>

          <button type="button" className="xbar-intelligence-rail-v2__next" onClick={() => navigate(nextMovePath)}>
            <span>Next release move</span>
            <strong>{nextMoveLabel}</strong>
          </button>

          <div className="xbar-intelligence-rail-v2__stack">
            <div><span>Listed value</span><strong>{formatCompactCurrency(revenueRisk.totalListedValue)}</strong></div>
            <div><span>Value held</span><strong>{formatCompactCurrency(revenueRisk.valueAtRisk)}</strong></div>
            <div><span>Buyers</span><strong>{activeBuyerCount}</strong><em>{qualifiedBuyerCount} qualified</em></div>
            <div><span>Documents</span><strong>{documents.length}</strong><em>{reviewQueue.length} review</em></div>
            <div><span>Spend</span><strong>{formatCurrency(budgetSummary.total)}</strong><em>{budgetSummary.receiptCount} receipts</em></div>
          </div>

          <div className="xbar-intelligence-rail-v2__queue">
            <span>Live queue</span>
            {(revenueRisk.items.length ? revenueRisk.items.slice(0, 3) : saleProfiles.slice(0, 3)).map((item) => {
              const horseName = 'horseName' in item ? item.horseName : item.horse.name;
              const score = 'packet' in item ? item.packet.score : null;
              return (
                <Link to={'horseId' in item ? `/horses/${item.horseId}` : `/horses/${item.horse.id}`} key={'horseId' in item ? item.horseId : item.horse.id}>
                  <strong>{horseName}</strong>
                  <em>{score === null ? 'Hold' : `${score}% ready`}</em>
                </Link>
              );
            })}
            {!revenueRisk.items.length && !saleProfiles.length ? (
              <Link to="/horses?new=1">
                <strong>Add first horse</strong>
                <em>Start readiness</em>
              </Link>
            ) : null}
          </div>

          <div className="xbar-intelligence-rail-v2__batch">
            <span>Latest document batch</span>
            <strong>{intakeBatches[0]?.label ?? 'No batch yet'}</strong>
            <em>{intakeBatches[0] ? `${intakeBatches[0].processedCount}/${intakeBatches[0].fileCount} processed` : 'Upload documents to begin.'}</em>
          </div>
        </div>
      </aside>
    </section>
  );
}
