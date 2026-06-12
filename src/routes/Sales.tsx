import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BuyerDealRoomPanel } from '@/components/BuyerDealRoomPanel';
import { BuyerResponseQueue } from '@/components/BuyerResponseQueue';
import { CommandBrief } from '@/components/CommandBrief';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { HorseMediaPreview } from '@/components/HorseMediaPreview';
import { ActionMenuButton } from '@/components/InteractionSystem';
import { OfferDecisionPanel } from '@/components/OfferDecisionPanel';
import { MetricCard, Panel, Pill } from '@/components/app-ui';
import { DotsIcon } from '@/components/icons';
import { buildPublicShareUrl } from '@/lib/facebookSharing';
import { formatCompactCurrency, formatDateLabel } from '@/lib/format';
import { buildOfferDecision } from '@/lib/profitIntelligence';
import { buildSaleHold } from '@/lib/saleTrustEngine';
import { useUiStore } from '@/store/useUiStore';
import { buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';

export default function Sales() {
  const navigate = useNavigate();
  const horses = useXbarStore((state) => state.horses);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const sharedAccess = useXbarStore((state) => state.sharedAccess);
  const sharedListings = useXbarStore((state) => state.sharedListings);
  const documents = useXbarStore((state) => state.documents);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const updateSalesLead = useXbarStore((state) => state.updateSalesLead);
  const recordSharedChannel = useXbarStore((state) => state.recordSharedChannel);
  const confirmSharedListingRelease = useXbarStore((state) => state.confirmSharedListingRelease);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const pushToast = useUiStore((state) => state.pushToast);
  const openRightDrawer = useUiStore((state) => state.openRightDrawer);
  const canManageSales = useCurrentRoleCapability('manageSales');
  const saleHorses = horses.filter(
    (horse) => horse.sale.askPrice > 0 || horse.sale.listingState === 'Buyer Review' || horse.sale.listingState === 'Market Ready',
  );
  const packetByHorseId = Object.fromEntries(
    saleHorses.map((horse) => [
      horse.id,
      buildHorsePacketCompleteness(
        horse,
        documents.filter((document) => document.horseId === horse.id),
        ownershipRecords.find((record) => record.horseId === horse.id),
      ),
    ]),
  );
  const liveShareCount = saleHorses.filter((horse) => packetByHorseId[horse.id]?.buyerSafe).length;
  const today = new Date().toISOString().slice(0, 10);
  const overdueLeads = salesLeads.filter((lead) => lead.stage !== 'Closed' && lead.nextFollowUp && lead.nextFollowUp <= today);
  const followUpsDue = salesLeads.filter((lead) => lead.nextFollowUp && lead.nextFollowUp <= today).length;
  const openProspects = salesLeads.filter((lead) => lead.stage !== 'Closed');
  const transferBlockedHorses = saleHorses.filter((horse) => horse.readiness.packetStatus === 'Needs Transfer Docs');
  const [selectedLeadId, setSelectedLeadId] = useState(salesLeads[0]?.id ?? '');
  const selectedLead = salesLeads.find((lead) => lead.id === selectedLeadId) ?? salesLeads[0];
  const [leadStage, setLeadStage] = useState(selectedLead?.stage ?? 'New');
  const [leadLastTouch, setLeadLastTouch] = useState(selectedLead?.lastTouch ?? new Date().toISOString().slice(0, 10));
  const [leadNextFollowUp, setLeadNextFollowUp] = useState(selectedLead?.nextFollowUp ?? '');
  const [leadOfferAmount, setLeadOfferAmount] = useState(selectedLead?.offerAmount ? String(selectedLead.offerAmount) : '');
  const [leadCounterOfferAmount, setLeadCounterOfferAmount] = useState(selectedLead?.counterOfferAmount ? String(selectedLead.counterOfferAmount) : '');
  const [leadOfferStatus, setLeadOfferStatus] = useState(selectedLead?.offerStatus ?? 'Draft');
  const [leadDepositAmount, setLeadDepositAmount] = useState(selectedLead?.depositAmount ? String(selectedLead.depositAmount) : '');
  const [leadDepositStatus, setLeadDepositStatus] = useState(selectedLead?.depositStatus ?? 'Not Requested');
  const [leadNotes, setLeadNotes] = useState(selectedLead?.notes ?? '');
  const [leadOutcome, setLeadOutcome] = useState(selectedLead?.outcome ?? 'Won');
  const [acceptMarginOverride, setAcceptMarginOverride] = useState(false);
  const [leadError, setLeadError] = useState('');
  const [menuState, setMenuState] = useState<{ type: 'lead' | 'horse'; id: string; x: number; y: number } | null>(null);
  const [listingQuery, setListingQuery] = useState('');
  const authorizedSeller = workspaceProfile.defaultOwnerName || workspaceProfile.ranchManagerName || workspaceProfile.businessName;
  const selectedHorse = selectedLead ? horses.find((horse) => horse.id === selectedLead.horseId) : undefined;
  const offerDecision = selectedHorse
    ? buildOfferDecision(selectedHorse, expenseReceipts, Number(leadOfferAmount) || 0, Number(leadCounterOfferAmount) || 0)
    : null;
  const menuLead = menuState?.type === 'lead' ? salesLeads.find((lead) => lead.id === menuState.id) : undefined;
  const menuHorse = menuState?.type === 'horse' ? saleHorses.find((horse) => horse.id === menuState.id) : undefined;
  const menuListing = menuHorse ? sharedListings.find((listing) => listing.horseId === menuHorse.id && listing.state !== 'Archived') : undefined;
  const menuPacket = menuHorse ? packetByHorseId[menuHorse.id] : undefined;
  const menuShareUrl = menuPacket
    ? buildPublicShareUrl(menuPacket.sharePath, menuListing?.accessMode === 'Private Token' ? menuListing.shareToken : undefined)
    : '';
  const openHorseDetails = (horse: (typeof saleHorses)[number]) => {
    const packet = packetByHorseId[horse.id];
    openRightDrawer({
      id: `sale-horse-${horse.id}`,
      eyebrow: 'Sale listing',
      title: horse.name,
      description: horse.summary,
      facts: [
        { label: 'Listing', value: horse.sale.listingState },
        { label: 'Ask', value: formatCompactCurrency(horse.sale.askPrice || horse.insuredValue) },
        { label: 'Record', value: `${packet?.score ?? 0}% complete` },
        { label: 'Watchers', value: String(horse.sale.watchlistCount) },
      ],
      actions: [
        { label: 'Open horse record', path: `/horses/${horse.id}` },
        { label: 'Open sale profile', path: `/profiles/${horse.id}` },
      ],
    });
  };
  const openLeadDetails = (lead: (typeof salesLeads)[number]) => {
    const horse = horses.find((item) => item.id === lead.horseId);
    openRightDrawer({
      id: `sales-lead-${lead.id}`,
      eyebrow: 'Sales lead',
      title: lead.name,
      description: lead.notes || `${lead.channel} inquiry for ${horse?.name ?? 'an unassigned horse'}.`,
      facts: [
        { label: 'Stage', value: lead.stage },
        { label: 'Horse', value: horse?.name ?? 'Unassigned' },
        { label: 'Last touch', value: formatDateLabel(lead.lastTouch) },
        { label: 'Next follow-up', value: lead.nextFollowUp ? formatDateLabel(lead.nextFollowUp) : 'Not scheduled' },
      ],
      actions: [
        { label: 'Open horse record', path: `/horses/${lead.horseId}` },
        { label: 'Open follow-ups', path: '/follow-ups' },
      ],
    });
  };
  const openMenu = (type: 'lead' | 'horse', id: string, x: number, y: number) => setMenuState({ type, id, x, y });
  const menuItems = menuLead
    ? [
        {
          id: 'lead-quick-view',
          label: 'Quick view',
          onSelect: () => openLeadDetails(menuLead),
        },
        ...(canManageSales
          ? [
              {
                id: 'qualified',
                label: 'Mark qualified',
                onSelect: () => {
                  const result = updateSalesLead(menuLead.id, { stage: 'Qualified', lastTouch: new Date().toISOString().slice(0, 10) });
                  pushToast({ title: result.ok ? 'Lead updated' : 'Lead update blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
                },
              },
              {
                id: 'offer',
                label: 'Move to offer',
                onSelect: () => {
                  const result = updateSalesLead(menuLead.id, { stage: 'Offer', lastTouch: new Date().toISOString().slice(0, 10) });
                  pushToast({ title: result.ok ? 'Lead updated' : 'Lead update blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
                },
              },
            ]
          : []),
        {
          id: 'open-horse',
          label: 'Open horse profile',
          onSelect: () => navigate(`/horses/${menuLead.horseId}`),
        },
      ]
    : menuHorse
      ? [
          {
            id: 'horse-quick-view',
            label: 'Quick view',
            onSelect: () => openHorseDetails(menuHorse),
          },
          {
            id: 'open-horse',
            label: 'Open horse record',
            onSelect: () => navigate(`/horses/${menuHorse.id}`),
          },
          {
            id: 'open-profile',
            label: 'Open sale listing',
            onSelect: async () => {
              const result = await recordSharedChannel(menuHorse.id, 'Direct Link');
              pushToast({ title: result.ok ? 'Buyer packet opened' : 'Release blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
              if (result.ok && typeof window !== 'undefined') {
                window.open(menuShareUrl, '_blank', 'noopener,noreferrer');
              }
            },
          },
        ]
      : [];

  return (
    <>
      <CommandBrief
        variant="wide"
        eyebrow="Sales"
        entity="Sales & Transfers"
        status={
          overdueLeads.length
            ? { label: 'Follow-ups overdue', tone: 'rose' }
            : transferBlockedHorses.length
              ? { label: 'Transfer paperwork pending', tone: 'amber' }
              : { label: 'Pipeline current', tone: 'blue' }
        }
        summary={`${saleHorses.length} active listings with ${openProspects.length} open prospects and ${liveShareCount} live sale links.`}
        evidence={[
          { label: 'Listings', value: String(saleHorses.length) },
          { label: 'Open prospects', value: String(openProspects.length), to: '/follow-ups' },
          { label: 'Follow-ups due', value: String(followUpsDue), to: '/follow-ups' },
        ]}
        risks={[
          ...overdueLeads.map((lead) => ({
            label: `${lead.name} — follow-up overdue since ${formatDateLabel(lead.nextFollowUp ?? today)}`,
            severity: 'rose' as const,
            to: '/follow-ups',
          })),
          ...transferBlockedHorses.map((horse) => ({
            label: `${horse.name} — needs transfer docs`,
            severity: 'amber' as const,
            to: '/ownership',
          })),
        ].slice(0, 5)}
        nextAction={{ label: 'Open follow-up queue', to: '/follow-ups' }}
      />

      <BuyerDealRoomPanel />
      <BuyerResponseQueue />

      <div className="metric-grid">
        <MetricCard label="Sale horses" value={`${saleHorses.length}`} detail="Active pricing or pending review" />
        <MetricCard label="Prospects" value={`${openProspects.length}`} detail="Open inquiries across all channels" tone="blue" />
        <MetricCard label="Shared records" value={`${sharedAccess.savedHorses}`} detail="Listings open in shared access" tone="blue" />
        <MetricCard label="Transfer blockers" value={`${transferBlockedHorses.length}`} detail="Listings with ownership or paperwork friction" tone="amber" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Listings" title="Listings">
          {saleHorses.length > 0 && (
            <div className="inline-search" style={{ marginBottom: '16px' }}>
              <input
                className="field-input"
                placeholder="Search by name, segment, status…"
                value={listingQuery}
                onChange={(e) => setListingQuery(e.target.value)}
                style={{ maxWidth: '360px' }}
              />
            </div>
          )}
          {saleHorses.length ? (
            <div className="horse-grid">
              {saleHorses.filter((h) => !listingQuery.trim() || h.name.toLowerCase().includes(listingQuery.toLowerCase()) || h.segment.toLowerCase().includes(listingQuery.toLowerCase())).map((horse) => (
                <div
                  key={horse.id}
                  className="horse-card horse-card--interactive"
                  role="group"
                  tabIndex={0}
                  aria-label={`Sale listing for ${horse.name}`}
                  title="Press Enter to open the horse record. Press Shift+F10 for actions."
                  onClick={() => navigate(`/horses/${horse.id}`)}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      navigate(`/horses/${horse.id}`);
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    openMenu('horse', horse.id, event.clientX, event.clientY);
                  }}
                >
                  {(() => {
                    const packet = packetByHorseId[horse.id];
                    const sharedListing = sharedListings.find((listing) => listing.horseId === horse.id && listing.state !== 'Archived');
                    const saleHold = buildSaleHold(horse, documents, ownershipRecords.find((record) => record.horseId === horse.id));
                    const publicShareUrl = buildPublicShareUrl(
                      packet.sharePath,
                      sharedListing?.accessMode === 'Private Token' ? sharedListing.shareToken : undefined,
                    );

                    return (
                      <>
                        <div className="horse-card__media">
                          <HorseMediaPreview
                            src={horse.profileImage || horse.gallery[0]?.url}
                            name={horse.name}
                            imageClassName="horse-card__image"
                            fallbackClassName="horse-card__image-fallback"
                          />
                          <div className="horse-card__media-copy">
                            <Pill tone={packet.buyerProfileTone}>{packet.buyerProfileStatus}</Pill>
                            <ActionMenuButton
                              className="icon-button icon-button--compact"
                              label={`Open actions for ${horse.name}`}
                              onOpen={(x, y) => openMenu('horse', horse.id, x, y)}
                            >
                              <DotsIcon className="icon-button__icon" />
                            </ActionMenuButton>
                          </div>
                        </div>
                        <div className="horse-card__body">
                          <div className="horse-card__title">{horse.name}</div>
                          <div className="horse-card__subtitle">{horse.sale.listingState}</div>
                          <Pill tone={saleHold.held ? 'rose' : sharedListing?.releaseConfirmedAt ? 'emerald' : 'amber'}>
                            {saleHold.held ? `Hold: ${saleHold.reasons[0]}` : sharedListing?.releaseConfirmedAt ? 'Seller release confirmed' : 'Seller release required'}
                          </Pill>
                          <p className="horse-card__summary">{horse.summary}</p>
                          <div className="inline-metrics">
                            <span>{packet.score}% record complete</span>
                            <span>{packet.shareSlug}</span>
                          </div>
                          <div className="horse-card__footer">
                            <span>{horse.sale.watchlistCount} watchers</span>
                            <span>{formatCompactCurrency(horse.sale.askPrice || horse.insuredValue)}</span>
                          </div>
                          <div className="inline-actions inline-actions--card">
                            <button
                              className="button button--ghost button--compact"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                openHorseDetails(horse);
                              }}
                            >
                              Quick view
                            </button>
                            <button
                              className="button button--ghost button--compact"
                              type="button"
                              onClick={async (event) => {
                                event.stopPropagation();
                                const result = await recordSharedChannel(horse.id, 'Direct Link');
                                pushToast({ title: result.ok ? 'Buyer packet opened' : 'Release blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
                                if (result.ok) window.open(publicShareUrl, '_blank', 'noopener,noreferrer');
                              }}
                            >
                              Open sale listing
                            </button>
                            <button
                              className="button button--primary button--compact"
                              type="button"
                              disabled={!canManageSales || saleHold.held || !sharedListing || Boolean(sharedListing.releaseConfirmedAt)}
                              onClick={async (event) => {
                                event.stopPropagation();
                                const result = await confirmSharedListingRelease(horse.id, authorizedSeller);
                                pushToast({ title: result.ok ? 'Release confirmed' : 'Confirmation blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
                              }}
                            >
                              {sharedListing?.releaseConfirmedAt ? 'Release confirmed' : 'Confirm legal release'}
                            </button>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No sale horses yet" description="Move a horse into review or market ready to populate the sales board." />
          )}
        </Panel>

        <Panel eyebrow="Leads" title="Pipeline">
          {salesLeads.length ? (
            <div className="stack-list">
              {salesLeads.map((lead) => {
                const horse = horses.find((item) => item.id === lead.horseId);
                return (
                  <div key={lead.id} className="record-action-row">
                    <button
                      type="button"
                      className={`stack-item stack-item--interactive${lead.id === selectedLeadId ? ' stack-item--selected' : ''}`}
                      onClick={() => {
                        setSelectedLeadId(lead.id);
                        setLeadStage(lead.stage);
                        setLeadLastTouch(lead.lastTouch);
                        setLeadNextFollowUp(lead.nextFollowUp ?? '');
                        setLeadOfferAmount(lead.offerAmount ? String(lead.offerAmount) : '');
                        setLeadCounterOfferAmount(lead.counterOfferAmount ? String(lead.counterOfferAmount) : '');
                        setLeadOfferStatus(lead.offerStatus ?? 'Draft');
                        setLeadDepositAmount(lead.depositAmount ? String(lead.depositAmount) : '');
                        setLeadDepositStatus(lead.depositStatus ?? 'Not Requested');
                        setLeadNotes(lead.notes ?? '');
                        setLeadOutcome(lead.outcome ?? 'Won');
                        setAcceptMarginOverride(false);
                        setLeadError('');
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        openMenu('lead', lead.id, event.clientX, event.clientY);
                      }}
                    >
                      <div className="stack-item__top">
                        <div>
                          <div className="stack-item__title">{lead.name}</div>
                          <div className="stack-item__copy">
                            {lead.channel} · {horse?.name}
                          </div>
                        </div>
                        <Pill tone={lead.stage === 'Offer' || lead.stage === 'Qualified' ? 'blue' : 'amber'}>
                          {lead.stage}
                        </Pill>
                      </div>
                      <div className="inline-metrics">
                        <span>{lead.savedListing ? 'Saved listing' : 'Not saved yet'}</span>
                        <span>{lead.shareReady ? 'Sale link live' : 'Sale link private'}</span>
                        <span>Last touch {formatDateLabel(lead.lastTouch)}</span>
                      </div>
                    </button>
                    <ActionMenuButton
                      className="record-action-row__menu icon-button icon-button--compact"
                      label={`Open actions for ${lead.name}`}
                      onOpen={(x, y) => openMenu('lead', lead.id, x, y)}
                    >
                      <DotsIcon className="icon-button__icon" />
                    </ActionMenuButton>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState compact title="No leads yet" description="Create a lead from a horse record to start the pipeline." />
          )}
        </Panel>
      </div>

      {offerDecision && selectedHorse ? (
        <OfferDecisionPanel
          decision={offerDecision}
          horseName={selectedHorse.name}
          overrideApproved={acceptMarginOverride}
          canManageSales={canManageSales}
          onOverrideApproved={setAcceptMarginOverride}
          onCounterAtFloor={() => {
            setLeadCounterOfferAmount(String(offerDecision.safeSalePrice));
            setLeadOfferStatus('Countered');
            setLeadStage('Offer');
            setAcceptMarginOverride(false);
            setLeadError('');
          }}
          onPrepareDeposit={() => {
            setLeadOfferStatus('Deposit Due');
            setLeadDepositStatus('Due');
            setLeadStage('Offer');
            setLeadError('');
          }}
        />
      ) : null}

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Lead lifecycle" title={selectedLead ? `${selectedLead.name} lead` : 'Lead'}>
          {selectedLead ? (
            <>
              <div className="form-grid form-grid--tight">
                <label className="field-stack">
                  <span className="field-label">Stage</span>
                  <select className="field-input" value={leadStage} onChange={(event) => setLeadStage(event.target.value as typeof leadStage)} disabled={!canManageSales}>
                    {(['New', 'Qualified', 'Offer', 'Closed'] as const).map((stage) => (
                      <option key={stage} value={stage}>
                        {stage}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-stack">
                  <span className="field-label">Last touch</span>
                  <input className="field-input" type="date" value={leadLastTouch} onChange={(event) => setLeadLastTouch(event.target.value)} disabled={!canManageSales} />
                </label>
                <label className="field-stack">
                  <span className="field-label">Next follow-up</span>
                  <input className="field-input" type="date" value={leadNextFollowUp} onChange={(event) => setLeadNextFollowUp(event.target.value)} disabled={!canManageSales} />
                </label>
                <label className="field-stack">
                  <span className="field-label">Offer amount</span>
                  <input className="field-input" type="number" min="0" value={leadOfferAmount} onChange={(event) => { setLeadOfferAmount(event.target.value); setAcceptMarginOverride(false); }} disabled={!canManageSales} />
                </label>
                <label className="field-stack">
                  <span className="field-label">Counteroffer</span>
                  <input className="field-input" type="number" min="0" value={leadCounterOfferAmount} onChange={(event) => { setLeadCounterOfferAmount(event.target.value); setAcceptMarginOverride(false); }} disabled={!canManageSales} />
                </label>
                <label className="field-stack">
                  <span className="field-label">Offer status</span>
                  <select className="field-input" value={leadOfferStatus} onChange={(event) => setLeadOfferStatus(event.target.value as typeof leadOfferStatus)} disabled={!canManageSales}>
                    {(['Draft', 'Submitted', 'Countered', 'Accepted', 'Rejected', 'Deposit Due', 'Deposit Paid'] as const).map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </label>
                <label className="field-stack">
                  <span className="field-label">Deposit amount</span>
                  <input className="field-input" type="number" min="0" value={leadDepositAmount} onChange={(event) => setLeadDepositAmount(event.target.value)} disabled={!canManageSales} />
                </label>
                <label className="field-stack">
                  <span className="field-label">Deposit status</span>
                  <select className="field-input" value={leadDepositStatus} onChange={(event) => setLeadDepositStatus(event.target.value as typeof leadDepositStatus)} disabled={!canManageSales}>
                    {(['Not Requested', 'Due', 'Paid'] as const).map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </label>
                <label className="field-stack">
                  <span className="field-label">Closed outcome</span>
                  <select className="field-input" value={leadOutcome} onChange={(event) => setLeadOutcome(event.target.value as 'Won' | 'Lost')} disabled={!canManageSales}>
                    <option value="Won">Won</option>
                    <option value="Lost">Lost</option>
                  </select>
                </label>
                <label className="field-stack field-stack--wide">
                  <span className="field-label">Notes</span>
                  <textarea className="field-textarea" rows={4} value={leadNotes} onChange={(event) => setLeadNotes(event.target.value)} disabled={!canManageSales} />
                </label>
              </div>
              {leadError ? <div className="field-error">{leadError}</div> : null}
              <div className="inline-actions">
                <button
                  className="button button--primary button--compact"
                  type="button"
                  onClick={() => {
                    if (!leadLastTouch.trim()) {
                      setLeadError('Last touch date is required.');
                      return;
                    }

                    const acceptingOffer = ['Accepted', 'Deposit Due', 'Deposit Paid'].includes(leadOfferStatus);
                    if (acceptingOffer && offerDecision?.acceptanceBlocked) {
                      setLeadError(`${offerDecision.label}. ${offerDecision.recommendation}`);
                      return;
                    }
                    if (acceptingOffer && offerDecision?.overrideRequired && !acceptMarginOverride) {
                      setLeadError('Review and approve the margin override before accepting this offer.');
                      return;
                    }
                    if (leadDepositStatus !== 'Not Requested' && !(Number(leadDepositAmount) > 0)) {
                      setLeadError('Deposit amount is required when the deposit is due or paid.');
                      return;
                    }
                    if (leadOfferStatus === 'Deposit Paid' && leadDepositStatus !== 'Paid') {
                      setLeadError('Mark the deposit status Paid before completing the deposit-paid step.');
                      return;
                    }

                    const result = updateSalesLead(selectedLead.id, {
                      stage: leadStage,
                      lastTouch: leadLastTouch,
                      nextFollowUp: leadNextFollowUp,
                      notes: leadNotes,
                      offerAmount: leadOfferAmount ? Number(leadOfferAmount) : undefined,
                      counterOfferAmount: leadCounterOfferAmount ? Number(leadCounterOfferAmount) : undefined,
                      offerStatus: leadOfferStatus,
                      depositAmount: leadDepositAmount ? Number(leadDepositAmount) : undefined,
                      depositStatus: leadDepositStatus,
                      outcome: leadStage === 'Closed' ? leadOutcome : undefined,
                    });

                    pushToast({
                      title: result.ok ? 'Lead updated' : 'Lead update blocked',
                      message: result.message,
                      tone: result.ok ? 'success' : 'error',
                    });
                    if (result.ok) {
                      setLeadError('');
                    }
                  }}
                  disabled={!canManageSales}
                >
                  Save lead changes
                </button>
              </div>
            </>
          ) : (
            <EmptyState compact title="No lead selected" description="Pick a lead from the pipeline to edit its lifecycle and notes." />
          )}
        </Panel>

        <Panel eyebrow="Handoff" title="Handoff">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Live links</div>
                <Pill tone={liveShareCount ? 'blue' : 'amber'}>{liveShareCount}</Pill>
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Shared records</div>
                <Pill tone={sharedAccess.savedHorses ? 'blue' : 'slate'}>{sharedAccess.savedHorses}</Pill>
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Follow-ups</div>
                <Pill tone={followUpsDue ? 'amber' : 'blue'}>{followUpsDue}</Pill>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <ContextMenu open={Boolean(menuState)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}
