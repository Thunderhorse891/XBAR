import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useConfirm } from '@/components/ConfirmDialog';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { HorseMediaPreview } from '@/components/HorseMediaPreview';
import { MetricCard, Panel, Pill } from '@/components/app-ui';
import { buildPublicShareUrl } from '@/lib/facebookSharing';
import { formatCompactCurrency, formatCurrency, formatDateLabel } from '@/lib/format';
import { useUiStore } from '@/store/useUiStore';
import { buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';

const STAGE_TONE: Record<string, 'slate' | 'blue' | 'amber' | 'emerald' | 'rose'> = {
  New: 'slate',
  Qualified: 'blue',
  Offer: 'amber',
  Closed: 'emerald',
};

export default function Sales() {
  const navigate = useNavigate();
  const horses = useXbarStore((state) => state.horses);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const sharedAccess = useXbarStore((state) => state.sharedAccess);
  const sharedListings = useXbarStore((state) => state.sharedListings);
  const documents = useXbarStore((state) => state.documents);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const updateSalesLead = useXbarStore((state) => state.updateSalesLead);
  const deleteSalesLead = useXbarStore((state) => state.deleteSalesLead);
  const recordSharedChannel = useXbarStore((state) => state.recordSharedChannel);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const { pushToast, openDrawer } = useUiStore((state) => ({ pushToast: state.pushToast, openDrawer: state.openDrawer }));
  const canManageSales = useCurrentRoleCapability('manageSales');
  const { confirm, dialog: confirmDialog } = useConfirm();
  const billOfSaleRef = useRef<HTMLDivElement>(null);
  const [showBillOfSale, setShowBillOfSale] = useState(false);
  const [menuState, setMenuState] = useState<{ type: 'lead' | 'horse'; id: string; x: number; y: number } | null>(null);
  const [listingQuery, setListingQuery] = useState('');
  const [selectedLeadId, setSelectedLeadId] = useState('');
  const [leadStage, setLeadStage] = useState<'New' | 'Qualified' | 'Offer' | 'Closed'>('New');
  const [leadLastTouch, setLeadLastTouch] = useState(new Date().toISOString().slice(0, 10));
  const [leadNextFollowUp, setLeadNextFollowUp] = useState('');
  const [leadOfferAmount, setLeadOfferAmount] = useState('');
  const [leadNotes, setLeadNotes] = useState('');
  const [leadOutcome, setLeadOutcome] = useState<'Won' | 'Lost'>('Won');
  const [leadError, setLeadError] = useState('');

  const saleHorses = useMemo(
    () => horses.filter((h) => h.sale.askPrice > 0 || h.sale.listingState === 'Buyer Review' || h.sale.listingState === 'Market Ready'),
    [horses],
  );
  const packetByHorseId = useMemo(
    () =>
      Object.fromEntries(
        saleHorses.map((h) => [
          h.id,
          buildHorsePacketCompleteness(
            h,
            documents.filter((d) => d.horseId === h.id),
            ownershipRecords.find((r) => r.horseId === h.id),
          ),
        ]),
      ),
    [saleHorses, documents, ownershipRecords],
  );
  const liveShareCount = saleHorses.filter((h) => packetByHorseId[h.id]?.buyerSafe).length;
  const followUpsDue = salesLeads.filter((l) => l.nextFollowUp && l.nextFollowUp <= new Date().toISOString().slice(0, 10)).length;
  const openLeads = salesLeads.filter((l) => l.stage !== 'Closed');
  const wonLeads = salesLeads.filter((l) => l.stage === 'Closed' && l.outcome === 'Won');
  const pipelineValue = openLeads.reduce((sum, l) => sum + (l.offerAmount ?? 0), 0);
  const wonValue = wonLeads.reduce((sum, l) => sum + (l.offerAmount ?? 0), 0);
  const pipelineByStage = useMemo(() => {
    const stages = ['New', 'Qualified', 'Offer', 'Closed'] as const;
    return stages.map((stage) => ({
      stage,
      count: salesLeads.filter((l) => l.stage === stage).length,
    }));
  }, [salesLeads]);

  const channelBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const lead of salesLeads) {
      map.set(lead.channel, (map.get(lead.channel) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [salesLeads]);

  const upcomingFollowUps = useMemo(
    () =>
      salesLeads
        .filter((l) => l.nextFollowUp && l.stage !== 'Closed')
        .sort((a, b) => (a.nextFollowUp ?? '').localeCompare(b.nextFollowUp ?? ''))
        .slice(0, 5),
    [salesLeads],
  );

  const selectedLead = salesLeads.find((l) => l.id === selectedLeadId) ?? salesLeads[0];
  const selectedLeadHorse = horses.find((h) => h.id === selectedLead?.horseId);

  useEffect(() => {
    if (salesLeads[0] && !selectedLeadId) {
      const first = salesLeads[0];
      setSelectedLeadId(first.id);
      setLeadStage(first.stage);
      setLeadLastTouch(first.lastTouch);
      setLeadNextFollowUp(first.nextFollowUp ?? '');
      setLeadOfferAmount(first.offerAmount ? String(first.offerAmount) : '');
      setLeadNotes(first.notes ?? '');
      setLeadOutcome(first.outcome ?? 'Won');
    }
  }, [salesLeads, selectedLeadId]);

  useEffect(() => {
    if (!showBillOfSale) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowBillOfSale(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showBillOfSale]);

  function selectLead(leadId: string) {
    const lead = salesLeads.find((l) => l.id === leadId);
    if (!lead) return;
    setSelectedLeadId(lead.id);
    setLeadStage(lead.stage);
    setLeadLastTouch(lead.lastTouch);
    setLeadNextFollowUp(lead.nextFollowUp ?? '');
    setLeadOfferAmount(lead.offerAmount ? String(lead.offerAmount) : '');
    setLeadNotes(lead.notes ?? '');
    setLeadOutcome(lead.outcome ?? 'Won');
    setLeadError('');
  }

  const menuLead = menuState?.type === 'lead' ? salesLeads.find((l) => l.id === menuState.id) : undefined;
  const menuHorse = menuState?.type === 'horse' ? saleHorses.find((h) => h.id === menuState.id) : undefined;
  const menuListing = menuHorse ? sharedListings.find((l) => l.horseId === menuHorse.id && l.state !== 'Archived') : undefined;
  const menuPacket = menuHorse ? packetByHorseId[menuHorse.id] : undefined;
  const menuShareUrl = menuPacket
    ? buildPublicShareUrl(menuPacket.sharePath, menuListing?.accessMode === 'Private Token' ? menuListing.shareToken : undefined)
    : '';

  const menuItems = menuLead
    ? [
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
        { id: 'open-horse', label: 'Open horse profile', onSelect: () => navigate(`/horses/${menuLead.horseId}`) },
        ...(canManageSales
          ? [
              {
                id: 'delete-lead',
                label: 'Delete lead',
                onSelect: async () => {
                  if (!await confirm('Delete lead?', `Remove "${menuLead.name}" from the pipeline? This cannot be undone.`)) return;
                  const result = deleteSalesLead(menuLead.id);
                  pushToast({ title: result.ok ? 'Lead removed' : 'Remove blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
                  if (result.ok && selectedLeadId === menuLead.id) setSelectedLeadId(salesLeads.find((l) => l.id !== menuLead.id)?.id ?? '');
                },
              },
            ]
          : []),
      ]
    : menuHorse
      ? [
          { id: 'open-horse', label: 'Open horse record', onSelect: () => navigate(`/horses/${menuHorse.id}`) },
          { id: 'view-horse-drawer', label: 'Quick view horse', onSelect: () => openDrawer({ type: 'horse-detail', horseId: menuHorse.id }) },
          {
            id: 'open-profile',
            label: 'Open sale listing',
            onSelect: async () => {
              await recordSharedChannel(menuHorse.id, 'Direct Link');
              if (typeof window !== 'undefined') window.open(menuShareUrl, '_blank', 'noopener,noreferrer');
            },
          },
        ]
      : [];

  return (
    <>
      {confirmDialog}

      <div className="surface-hero surface-hero--dark">
        <div className="surface-hero__top">
          <div>
            <span className="surface-hero__eyebrow">Sales & Transfers</span>
            <h1 className="surface-hero__title">Sales</h1>
          </div>
          <div className="surface-hero__stats">
            <div className="surface-hero__stat"><span>Listings</span><strong>{saleHorses.length}</strong></div>
            <div className="surface-hero__stat"><span>Open prospects</span><strong>{openLeads.length}</strong></div>
            <div className="surface-hero__stat">
              <span>Follow-ups due</span>
              <strong className={followUpsDue ? 'text-rose' : 'text-emerald'}>{followUpsDue}</strong>
            </div>
            <div className="surface-hero__stat">
              <span>Pipeline value</span>
              <strong>{formatCompactCurrency(pipelineValue)}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard label="Sale horses" value={`${saleHorses.length}`} detail="Active pricing or pending review" />
        <MetricCard label="Pipeline value" value={formatCompactCurrency(pipelineValue)} detail={`${openLeads.length} open lead${openLeads.length !== 1 ? 's' : ''}`} tone="blue" />
        <MetricCard label="Won deals" value={formatCompactCurrency(wonValue)} detail={`${wonLeads.length} closed won`} tone="emerald" />
        <MetricCard
          label="Transfer blockers"
          value={`${saleHorses.filter((h) => h.readiness.packetStatus === 'Needs Transfer Docs').length}`}
          detail="Ownership or paperwork friction"
          tone={saleHorses.some((h) => h.readiness.packetStatus === 'Needs Transfer Docs') ? 'amber' : 'slate'}
        />
      </div>

      {salesLeads.length > 0 && (
        <div className="dash-pipeline" style={{ marginBottom: '4px' }}>
          {pipelineByStage.map(({ stage, count }) => (
            <div key={stage} className={`dash-pipeline__stage dash-pipeline__stage--${stage.toLowerCase()}`}>
              <div className="dash-pipeline__count">{count}</div>
              <div style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text)', marginTop: '2px' }}>{stage}</div>
            </div>
          ))}
        </div>
      )}

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Listings" title="Sale horses">
          {saleHorses.length > 0 && (
            <div className="search-wrap">
              <input
                className="field-input"
                placeholder="Search by name, segment, status…"
                aria-label="Search listings"
                value={listingQuery}
                onChange={(e) => setListingQuery(e.target.value)}
              />
            </div>
          )}
          {saleHorses.length ? (
            <div className="horse-grid">
              {saleHorses
                .filter((h) => !listingQuery.trim() || h.name.toLowerCase().includes(listingQuery.toLowerCase()) || h.segment.toLowerCase().includes(listingQuery.toLowerCase()))
                .map((horse) => {
                  const packet = packetByHorseId[horse.id];
                  const sharedListing = sharedListings.find((l) => l.horseId === horse.id && l.state !== 'Archived');
                  const publicShareUrl = buildPublicShareUrl(
                    packet.sharePath,
                    sharedListing?.accessMode === 'Private Token' ? sharedListing.shareToken : undefined,
                  );
                  return (
                    <Link
                      key={horse.id}
                      className="horse-card horse-card--interactive"
                      to={`/horses/${horse.id}`}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        setMenuState({ type: 'horse', id: horse.id, x: event.clientX, y: event.clientY });
                      }}
                    >
                      <div className="horse-card__media">
                        <HorseMediaPreview
                          src={horse.profileImage || horse.gallery[0]?.url}
                          name={horse.name}
                          imageClassName="horse-card__image"
                          fallbackClassName="horse-card__image-fallback"
                        />
                        <div className="horse-card__media-copy">
                          <Pill tone={packet.buyerProfileTone}>{packet.buyerProfileStatus}</Pill>
                        </div>
                      </div>
                      <div className="horse-card__body">
                        <div className="horse-card__title">{horse.name}</div>
                        <div className="horse-card__subtitle">{horse.sale.listingState}</div>
                        <p className="horse-card__summary">{horse.summary}</p>
                        <div className="inline-metrics">
                          <span>{packet.score}% complete</span>
                          <span>{packet.shareSlug}</span>
                        </div>
                        <div className="horse-card__footer">
                          <span>{horse.sale.watchlistCount} watchers</span>
                          <span>{horse.sale.askPrice ? formatCompactCurrency(horse.sale.askPrice) : '—'}</span>
                        </div>
                        <div className="inline-actions inline-actions--card">
                          <a
                            className="button button--ghost button--compact"
                            href={publicShareUrl}
                            target="_blank"
                            rel="noreferrer"
                            onClick={async (event) => {
                              event.stopPropagation();
                              await recordSharedChannel(horse.id, 'Direct Link');
                            }}
                          >
                            Open sale listing
                          </a>
                        </div>
                      </div>
                    </Link>
                  );
                })}
            </div>
          ) : (
            <EmptyState compact title="No sale horses yet" description="Move a horse into review or market ready to populate the sales board." />
          )}
        </Panel>

        <Panel eyebrow="Leads" title="Pipeline">
          {salesLeads.length ? (
            <div className="stack-list">
              {salesLeads.map((lead) => {
                const horse = horses.find((h) => h.id === lead.horseId);
                const isOverdue = lead.nextFollowUp && lead.nextFollowUp <= new Date().toISOString().slice(0, 10) && lead.stage !== 'Closed';
                return (
                  <button
                    key={lead.id}
                    type="button"
                    className={`stack-item stack-item--interactive${lead.id === selectedLeadId ? ' stack-item--selected' : ''}`}
                    onClick={() => selectLead(lead.id)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenuState({ type: 'lead', id: lead.id, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <div className="stack-item__top">
                      <div>
                        <div className="stack-item__title">{lead.name}</div>
                        <div className="stack-item__copy">{lead.channel}{horse?.name ? ` · ${horse.name}` : ''}</div>
                      </div>
                      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                        {isOverdue && <Pill tone="rose">Due</Pill>}
                        <Pill tone={STAGE_TONE[lead.stage] ?? 'slate'}>{lead.stage}</Pill>
                      </div>
                    </div>
                    <div className="inline-metrics">
                      {lead.offerAmount ? <span>{formatCompactCurrency(lead.offerAmount)}</span> : null}
                      <span>{lead.savedListing ? 'Saved listing' : 'Not saved'}</span>
                      <span>Touched {formatDateLabel(lead.lastTouch)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState compact title="No leads yet" description="Create a lead from a horse record to start the pipeline." />
          )}
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Lead lifecycle" title={selectedLead ? `${selectedLead.name}` : 'Lead'}>
          {selectedLead ? (
            <>
              {selectedLeadHorse && (
                <div className="command-stage__support-card" style={{ marginBottom: '16px' }}>
                  <div className="command-stage__support-label">Horse</div>
                  <strong className="command-stage__support-title">{selectedLeadHorse.name}</strong>
                  <div className="command-stage__support-copy">
                    <span>{selectedLeadHorse.breed} · {selectedLeadHorse.sex} · {selectedLeadHorse.age}yr</span>
                    <span>{selectedLeadHorse.sale.listingState}</span>
                    {selectedLeadHorse.sale.askPrice > 0 && <span>Ask: {formatCompactCurrency(selectedLeadHorse.sale.askPrice)}</span>}
                  </div>
                </div>
              )}

              <div className="form-grid form-grid--tight">
                <label className="field-stack">
                  <span className="field-label">Stage</span>
                  <select className="field-input" value={leadStage} onChange={(e) => setLeadStage(e.target.value as typeof leadStage)} disabled={!canManageSales}>
                    {(['New', 'Qualified', 'Offer', 'Closed'] as const).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="field-stack">
                  <span className="field-label">Last touch</span>
                  <input className="field-input" type="date" value={leadLastTouch} onChange={(e) => setLeadLastTouch(e.target.value)} disabled={!canManageSales} />
                </label>
                <label className="field-stack">
                  <span className="field-label">Next follow-up</span>
                  <input className="field-input" type="date" value={leadNextFollowUp} onChange={(e) => setLeadNextFollowUp(e.target.value)} disabled={!canManageSales} />
                </label>
                <label className="field-stack">
                  <span className="field-label">Offer amount</span>
                  <input className="field-input" type="number" min="0" value={leadOfferAmount} onChange={(e) => setLeadOfferAmount(e.target.value)} disabled={!canManageSales} />
                </label>
                <label className="field-stack">
                  <span className="field-label">Closed outcome</span>
                  <select className="field-input" value={leadOutcome} onChange={(e) => setLeadOutcome(e.target.value as 'Won' | 'Lost')} disabled={!canManageSales}>
                    <option value="Won">Won</option>
                    <option value="Lost">Lost</option>
                  </select>
                </label>
                <label className="field-stack field-stack--wide">
                  <span className="field-label">Notes</span>
                  <textarea className="field-textarea" rows={4} value={leadNotes} onChange={(e) => setLeadNotes(e.target.value)} disabled={!canManageSales} />
                </label>
              </div>

              {leadError ? <div className="field-error">{leadError}</div> : null}

              <div className="inline-actions">
                <button
                  className="button button--primary button--compact"
                  type="button"
                  onClick={() => {
                    if (!leadLastTouch.trim()) { setLeadError('Last touch date is required.'); return; }
                    if (leadOfferAmount && Number(leadOfferAmount) < 0) { setLeadError('Offer amount cannot be negative.'); return; }
                    const result = updateSalesLead(selectedLead.id, {
                      stage: leadStage,
                      lastTouch: leadLastTouch,
                      nextFollowUp: leadNextFollowUp,
                      notes: leadNotes,
                      offerAmount: leadOfferAmount ? Number(leadOfferAmount) : undefined,
                      outcome: leadStage === 'Closed' ? leadOutcome : undefined,
                    });
                    pushToast({ title: result.ok ? 'Lead updated' : 'Lead update blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
                    if (result.ok) setLeadError('');
                  }}
                  disabled={!canManageSales}
                >
                  Save changes
                </button>
                <button className="button button--ghost button--compact" type="button" onClick={() => setShowBillOfSale(true)}>
                  Bill of Sale
                </button>
                {canManageSales && (
                  <button
                    className="button button--ghost button--compact button--danger-ghost"
                    type="button"
                    onClick={async () => {
                      if (!await confirm('Delete lead?', `Remove "${selectedLead.name}" from the pipeline? This cannot be undone.`)) return;
                      const result = deleteSalesLead(selectedLead.id);
                      pushToast({ title: result.ok ? 'Lead removed' : 'Remove blocked', message: result.message, tone: result.ok ? 'success' : 'error' });
                      if (result.ok) setSelectedLeadId(salesLeads.find((l) => l.id !== selectedLead.id)?.id ?? '');
                    }}
                  >
                    Delete lead
                  </button>
                )}
              </div>
            </>
          ) : (
            <EmptyState compact title="No lead selected" description="Pick a lead from the pipeline to edit its lifecycle and notes." />
          )}
        </Panel>

        <Panel eyebrow="Handoff" title="Deal intelligence">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Live sale links</div>
                <Pill tone={liveShareCount ? 'emerald' : 'amber'}>{liveShareCount}</Pill>
              </div>
              <div className="inline-metrics"><span>{saleHorses.length - liveShareCount} not yet buyer-safe</span></div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Shared records saved</div>
                <Pill tone={sharedAccess.savedHorses ? 'blue' : 'slate'}>{sharedAccess.savedHorses}</Pill>
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Follow-ups due</div>
                <Pill tone={followUpsDue ? 'rose' : 'emerald'}>{followUpsDue}</Pill>
              </div>
            </div>

            {channelBreakdown.length > 0 && (
              <>
                <div className="ops-section-label" style={{ paddingTop: '8px' }}>Lead sources</div>
                {channelBreakdown.map(([channel, count]) => (
                  <div key={channel} className="stack-item">
                    <div className="stack-item__top">
                      <div className="stack-item__title">{channel}</div>
                      <Pill tone="slate">{count}</Pill>
                    </div>
                  </div>
                ))}
              </>
            )}

            {upcomingFollowUps.length > 0 && (
              <>
                <div className="ops-section-label" style={{ paddingTop: '8px' }}>Upcoming follow-ups</div>
                {upcomingFollowUps.map((lead) => {
                  const horse = horses.find((h) => h.id === lead.horseId);
                  const isOverdue = lead.nextFollowUp && lead.nextFollowUp <= new Date().toISOString().slice(0, 10);
                  return (
                    <button
                      key={lead.id}
                      type="button"
                      className="stack-item stack-item--interactive"
                      onClick={() => selectLead(lead.id)}
                    >
                      <div className="stack-item__top">
                        <div className="stack-item__title">{lead.name}</div>
                        <Pill tone={isOverdue ? 'rose' : 'amber'}>{lead.nextFollowUp ? formatDateLabel(lead.nextFollowUp) : 'Unscheduled'}</Pill>
                      </div>
                      <div className="inline-metrics">
                        <span>{horse?.name ?? 'Unassigned'}</span>
                        <span>{lead.stage}</span>
                      </div>
                    </button>
                  );
                })}
              </>
            )}
          </div>
        </Panel>
      </div>

      <ContextMenu open={Boolean(menuState)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />

      {showBillOfSale && selectedLead && (() => {
        const bsHorse = horses.find((h) => h.id === selectedLead.horseId);
        const saleDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const salePrice = leadOfferAmount ? Number(leadOfferAmount) : bsHorse?.sale.askPrice ?? 0;
        const sellerName = bsHorse?.owner || workspaceProfile.defaultOwnerName || workspaceProfile.businessName || 'Seller';
        const sellerEntity = bsHorse?.ownerEntity || workspaceProfile.defaultOwnerEntity || workspaceProfile.businessName || '';
        return (
          <div className="bos-overlay" role="presentation" onClick={() => setShowBillOfSale(false)}>
            <div className="bos-modal" role="dialog" aria-modal="true" aria-label="Bill of Sale" onClick={(e) => e.stopPropagation()}>
              <div className="bos-header">
                <span className="bos-header__title">Bill of Sale</span>
                <div className="bos-header__actions">
                  <button
                    type="button"
                    className="bos-btn bos-btn--primary"
                    onClick={() => {
                      const content = billOfSaleRef.current?.innerHTML ?? '';
                      const win = window.open('', '_blank');
                      if (!win) return;
                      const rawTitle = bsHorse?.name ?? selectedLead.name;
                      const safeTitle = rawTitle.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
                      win.document.write(`<!DOCTYPE html><html><head><title>Bill of Sale — ${safeTitle}</title><style>body{font-family:Georgia,serif;max-width:680px;margin:40px auto;padding:0 32px;color:#111;line-height:1.6}h1{font-size:22px;text-align:center;margin-bottom:4px}h2{font-size:15px;font-weight:600;margin:24px 0 6px;border-bottom:1px solid #ccc;padding-bottom:4px}p{margin:4px 0}table{width:100%;border-collapse:collapse;margin-top:6px}td{padding:4px 8px;border:1px solid #ddd;font-size:13px}.sig-block{display:flex;gap:40px;margin-top:32px}.sig-line{flex:1;border-top:1px solid #333;padding-top:6px;font-size:12px}.disclaimer{font-size:11px;color:#666;margin-top:24px;border-top:1px solid #e0e0e0;padding-top:12px}@media print{body{margin:0}}</style></head><body>${content}</body></html>`);
                      win.document.close();
                      win.print();
                    }}
                  >
                    Print / Save PDF
                  </button>
                  <button type="button" autoFocus className="bos-btn" onClick={() => setShowBillOfSale(false)}>Close</button>
                </div>
              </div>
              <div ref={billOfSaleRef} className="bos-document" style={{ fontFamily: 'Georgia, serif', fontSize: '14px', lineHeight: '1.7', color: '#111' }}>
                <h1 style={{ textAlign: 'center', fontSize: '22px', margin: '0 0 4px', letterSpacing: '0.02em' }}>BILL OF SALE</h1>
                <p style={{ textAlign: 'center', fontSize: '13px', color: '#555', marginBottom: '24px' }}>Horse sale agreement — {saleDate}</p>

                <h2 style={{ fontSize: '14px', fontWeight: 700, borderBottom: '1px solid #bbb', paddingBottom: '4px', margin: '20px 0 8px' }}>Horse Description</h2>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <tbody>
                    <tr><td style={{ padding: '4px 8px', border: '1px solid #ddd', width: '40%', background: '#f8f8f8', fontWeight: 600 }}>Registered Name</td><td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{bsHorse?.name ?? '—'}</td></tr>
                    {bsHorse?.barnName && <tr><td style={{ padding: '4px 8px', border: '1px solid #ddd', background: '#f8f8f8', fontWeight: 600 }}>Barn Name</td><td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{bsHorse.barnName}</td></tr>}
                    <tr><td style={{ padding: '4px 8px', border: '1px solid #ddd', background: '#f8f8f8', fontWeight: 600 }}>Breed</td><td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{bsHorse?.breed ?? '—'}</td></tr>
                    <tr><td style={{ padding: '4px 8px', border: '1px solid #ddd', background: '#f8f8f8', fontWeight: 600 }}>Sex</td><td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{bsHorse?.sex ?? '—'}</td></tr>
                    <tr><td style={{ padding: '4px 8px', border: '1px solid #ddd', background: '#f8f8f8', fontWeight: 600 }}>Color</td><td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{bsHorse?.color ?? '—'}</td></tr>
                    <tr><td style={{ padding: '4px 8px', border: '1px solid #ddd', background: '#f8f8f8', fontWeight: 600 }}>Age</td><td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{bsHorse?.age ? `${bsHorse.age} years` : '—'}</td></tr>
                    {bsHorse?.registrationNumber && <tr><td style={{ padding: '4px 8px', border: '1px solid #ddd', background: '#f8f8f8', fontWeight: 600 }}>Registration #</td><td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{bsHorse.registrationNumber}</td></tr>}
                    {bsHorse?.registry && <tr><td style={{ padding: '4px 8px', border: '1px solid #ddd', background: '#f8f8f8', fontWeight: 600 }}>Registry</td><td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{bsHorse.registry}</td></tr>}
                    {bsHorse?.microchipId && <tr><td style={{ padding: '4px 8px', border: '1px solid #ddd', background: '#f8f8f8', fontWeight: 600 }}>Microchip / Brand</td><td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{bsHorse.microchipId}</td></tr>}
                    {bsHorse?.markings && <tr><td style={{ padding: '4px 8px', border: '1px solid #ddd', background: '#f8f8f8', fontWeight: 600 }}>Markings</td><td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{bsHorse.markings}</td></tr>}
                  </tbody>
                </table>

                <h2 style={{ fontSize: '14px', fontWeight: 700, borderBottom: '1px solid #bbb', paddingBottom: '4px', margin: '20px 0 8px' }}>Sale Terms</h2>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <tbody>
                    <tr><td style={{ padding: '4px 8px', border: '1px solid #ddd', width: '40%', background: '#f8f8f8', fontWeight: 600 }}>Sale Price</td><td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{salePrice ? formatCurrency(salePrice) : 'Agreed upon consideration'}</td></tr>
                    <tr><td style={{ padding: '4px 8px', border: '1px solid #ddd', background: '#f8f8f8', fontWeight: 600 }}>Sale Date</td><td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{saleDate}</td></tr>
                    <tr><td style={{ padding: '4px 8px', border: '1px solid #ddd', background: '#f8f8f8', fontWeight: 600 }}>Transfer of Title</td><td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>Upon receipt of full payment</td></tr>
                  </tbody>
                </table>

                <h2 style={{ fontSize: '14px', fontWeight: 700, borderBottom: '1px solid #bbb', paddingBottom: '4px', margin: '20px 0 8px' }}>Seller</h2>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <tbody>
                    <tr><td style={{ padding: '4px 8px', border: '1px solid #ddd', width: '40%', background: '#f8f8f8', fontWeight: 600 }}>Name</td><td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{sellerName}</td></tr>
                    {sellerEntity && <tr><td style={{ padding: '4px 8px', border: '1px solid #ddd', background: '#f8f8f8', fontWeight: 600 }}>Entity</td><td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{sellerEntity}</td></tr>}
                    {workspaceProfile.ranchName && <tr><td style={{ padding: '4px 8px', border: '1px solid #ddd', background: '#f8f8f8', fontWeight: 600 }}>Ranch</td><td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{workspaceProfile.ranchName}</td></tr>}
                  </tbody>
                </table>

                <h2 style={{ fontSize: '14px', fontWeight: 700, borderBottom: '1px solid #bbb', paddingBottom: '4px', margin: '20px 0 8px' }}>Buyer</h2>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                  <tbody>
                    <tr><td style={{ padding: '4px 8px', border: '1px solid #ddd', width: '40%', background: '#f8f8f8', fontWeight: 600 }}>Name</td><td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{selectedLead.name}</td></tr>
                    <tr><td style={{ padding: '4px 8px', border: '1px solid #ddd', background: '#f8f8f8', fontWeight: 600 }}>Source</td><td style={{ padding: '4px 8px', border: '1px solid #ddd' }}>{selectedLead.channel}</td></tr>
                  </tbody>
                </table>

                <p style={{ marginTop: '24px', fontSize: '13px' }}>
                  Seller warrants that they have clear title to the above-described horse and the right to sell the same.
                  The horse is sold in its present condition, and the buyer acknowledges having had the opportunity to inspect
                  the horse prior to the sale. This sale is final. No warranties, express or implied, are made regarding
                  the horse's health, soundness, or fitness for any particular purpose unless separately stated in writing.
                </p>

                <div style={{ display: 'flex', gap: '40px', marginTop: '40px' }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ borderTop: '1px solid #333', paddingTop: '6px', fontSize: '12px' }}>
                      <div>Seller Signature</div>
                      <div style={{ marginTop: '24px', borderTop: '1px solid #333', paddingTop: '4px' }}>{sellerName}</div>
                      <div style={{ marginTop: '20px', borderTop: '1px solid #555', paddingTop: '4px' }}>Date</div>
                    </div>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ borderTop: '1px solid #333', paddingTop: '6px', fontSize: '12px' }}>
                      <div>Buyer Signature</div>
                      <div style={{ marginTop: '24px', borderTop: '1px solid #333', paddingTop: '4px' }}>{selectedLead.name}</div>
                      <div style={{ marginTop: '20px', borderTop: '1px solid #555', paddingTop: '4px' }}>Date</div>
                    </div>
                  </div>
                </div>

                <p style={{ marginTop: '24px', fontSize: '11px', color: '#777', borderTop: '1px solid #ddd', paddingTop: '12px' }}>
                  Generated by XBAR LLC™ Ranch Platform. This document is provided as a template for informational purposes only and does not constitute legal advice. Parties are encouraged to have this agreement reviewed by legal counsel before execution.
                </p>
              </div>
            </div>
          </div>
        );
      })()}
    </>
  );
}
