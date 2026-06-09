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
  const saleHorses = useMemo(
    () => horses.filter((horse) => horse.sale.askPrice > 0 || horse.sale.listingState === 'Buyer Review' || horse.sale.listingState === 'Market Ready'),
    [horses],
  );
  const packetByHorseId = useMemo(
    () =>
      Object.fromEntries(
        saleHorses.map((horse) => [
          horse.id,
          buildHorsePacketCompleteness(
            horse,
            documents.filter((document) => document.horseId === horse.id),
            ownershipRecords.find((record) => record.horseId === horse.id),
          ),
        ]),
      ),
    [saleHorses, documents, ownershipRecords],
  );
  const liveShareCount = saleHorses.filter((horse) => packetByHorseId[horse.id]?.buyerSafe).length;
  const followUpsDue = salesLeads.filter((lead) => lead.nextFollowUp && lead.nextFollowUp <= new Date().toISOString().slice(0, 10)).length;
  const [selectedLeadId, setSelectedLeadId] = useState(salesLeads[0]?.id ?? '');
  const selectedLead = salesLeads.find((lead) => lead.id === selectedLeadId) ?? salesLeads[0];
  const [leadStage, setLeadStage] = useState(selectedLead?.stage ?? 'New');
  const [leadLastTouch, setLeadLastTouch] = useState(selectedLead?.lastTouch ?? new Date().toISOString().slice(0, 10));
  const [leadNextFollowUp, setLeadNextFollowUp] = useState(selectedLead?.nextFollowUp ?? '');
  const [leadOfferAmount, setLeadOfferAmount] = useState(selectedLead?.offerAmount ? String(selectedLead.offerAmount) : '');
  const [leadNotes, setLeadNotes] = useState(selectedLead?.notes ?? '');
  const [leadOutcome, setLeadOutcome] = useState(selectedLead?.outcome ?? 'Won');
  const [leadError, setLeadError] = useState('');
  const [menuState, setMenuState] = useState<{ type: 'lead' | 'horse'; id: string; x: number; y: number } | null>(null);
  const [listingQuery, setListingQuery] = useState('');
  const [showBillOfSale, setShowBillOfSale] = useState(false);
  const billOfSaleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showBillOfSale) return;
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowBillOfSale(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showBillOfSale]);

  const menuLead = menuState?.type === 'lead' ? salesLeads.find((lead) => lead.id === menuState.id) : undefined;
  const menuHorse = menuState?.type === 'horse' ? saleHorses.find((horse) => horse.id === menuState.id) : undefined;
  const menuListing = menuHorse ? sharedListings.find((listing) => listing.horseId === menuHorse.id && listing.state !== 'Archived') : undefined;
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
        {
          id: 'open-horse',
          label: 'Open horse profile',
          onSelect: () => navigate(`/horses/${menuLead.horseId}`),
        },
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
          {
            id: 'open-horse',
            label: 'Open horse record',
            onSelect: () => navigate(`/horses/${menuHorse.id}`),
          },
          {
            id: 'view-horse-drawer',
            label: 'Quick view horse',
            onSelect: () => openDrawer({ type: 'horse-detail', horseId: menuHorse.id }),
          },
          {
            id: 'open-profile',
            label: 'Open sale listing',
            onSelect: async () => {
              await recordSharedChannel(menuHorse.id, 'Direct Link');
              if (typeof window !== 'undefined') {
                window.open(menuShareUrl, '_blank', 'noopener,noreferrer');
              }
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
          </div>
          <div className="surface-hero__stats">
            <div className="surface-hero__stat"><span>Listings</span><strong>{saleHorses.length}</strong></div>
            <div className="surface-hero__stat"><span>Open prospects</span><strong>{salesLeads.filter((lead) => lead.stage !== 'Closed').length}</strong></div>
            <div className="surface-hero__stat">
              <span>Follow-ups due</span>
              <strong className={followUpsDue ? 'text-rose' : 'text-emerald'}>{followUpsDue}</strong>
            </div>
            <div className="surface-hero__stat">
              <span>Blockers</span>
              <strong className={saleHorses.filter((h) => h.readiness.packetStatus === 'Needs Transfer Docs').length ? 'text-amber' : 'text-emerald'}>
                {saleHorses.filter((h) => h.readiness.packetStatus === 'Needs Transfer Docs').length}
              </strong>
            </div>
          </div>
        </div>
      </div>

      <div className="metric-grid">
        <MetricCard label="Sale horses" value={`${saleHorses.length}`} detail="Active pricing or pending review" />
        <MetricCard label="Prospects" value={`${salesLeads.filter((lead) => lead.stage !== 'Closed').length}`} detail="Open inquiries across all channels" tone="blue" />
        <MetricCard label="Shared records" value={`${sharedAccess.savedHorses}`} detail="Listings open in shared access" tone="emerald" />
        <MetricCard label="Transfer blockers" value={`${saleHorses.filter((horse) => horse.readiness.packetStatus === 'Needs Transfer Docs').length}`} detail="Listings with ownership or paperwork friction" tone="amber" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Listings" title="Listings">
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
              {saleHorses.filter((h) => !listingQuery.trim() || h.name.toLowerCase().includes(listingQuery.toLowerCase()) || h.segment.toLowerCase().includes(listingQuery.toLowerCase())).map((horse) => (
                <Link
                  key={horse.id}
                  className="horse-card horse-card--interactive"
                  to={`/horses/${horse.id}`}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenuState({ type: 'horse', id: horse.id, x: event.clientX, y: event.clientY });
                  }}
                >
                  {(() => {
                    const packet = packetByHorseId[horse.id];
                    const sharedListing = sharedListings.find((listing) => listing.horseId === horse.id && listing.state !== 'Archived');
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
                          </div>
                        </div>
                        <div className="horse-card__body">
                          <div className="horse-card__title">{horse.name}</div>
                          <div className="horse-card__subtitle">{horse.sale.listingState}</div>
                          <p className="horse-card__summary">{horse.summary}</p>
                          <div className="inline-metrics">
                            <span>{packet.score}% record complete</span>
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
                      </>
                    );
                  })()}
                </Link>
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
                  <button
                    key={lead.id}
                    type="button"
                    className={`stack-item stack-item--interactive${lead.id === selectedLeadId ? ' stack-item--selected' : ''}`}
                    onClick={() => {
                      setSelectedLeadId(lead.id);
                      setLeadStage(lead.stage);
                      setLeadLastTouch(lead.lastTouch);
                      setLeadNextFollowUp(lead.nextFollowUp ?? '');
                      setLeadOfferAmount(lead.offerAmount ? String(lead.offerAmount) : '');
                      setLeadNotes(lead.notes ?? '');
                      setLeadOutcome(lead.outcome ?? 'Won');
                      setLeadError('');
                    }}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenuState({ type: 'lead', id: lead.id, x: event.clientX, y: event.clientY });
                    }}
                  >
                    <div className="stack-item__top">
                      <div>
                        <div className="stack-item__title">{lead.name}</div>
                        <div className="stack-item__copy">
                          {lead.channel}{horse?.name ? ` · ${horse.name}` : ''}
                        </div>
                      </div>
                      <Pill tone={lead.stage === 'Offer' ? 'emerald' : lead.stage === 'Qualified' ? 'blue' : 'amber'}>
                        {lead.stage}
                      </Pill>
                    </div>
                    <div className="inline-metrics">
                      <span>{lead.savedListing ? 'Saved listing' : 'Not saved yet'}</span>
                      <span>{lead.shareReady ? 'Sale link live' : 'Sale link private'}</span>
                      <span>Last touch {formatDateLabel(lead.lastTouch)}</span>
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
                  <input className="field-input" type="number" min="0" value={leadOfferAmount} onChange={(event) => setLeadOfferAmount(event.target.value)} disabled={!canManageSales} />
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
                    if (leadOfferAmount && Number(leadOfferAmount) < 0) {
                      setLeadError('Offer amount cannot be negative.');
                      return;
                    }

                    const result = updateSalesLead(selectedLead.id, {
                      stage: leadStage,
                      lastTouch: leadLastTouch,
                      nextFollowUp: leadNextFollowUp,
                      notes: leadNotes,
                      offerAmount: leadOfferAmount ? Number(leadOfferAmount) : undefined,
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
                <button
                  className="button button--ghost button--compact"
                  type="button"
                  onClick={() => setShowBillOfSale(true)}
                >
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

        <Panel eyebrow="Handoff" title="Handoff">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Live links</div>
                <Pill tone={liveShareCount ? 'emerald' : 'amber'}>{liveShareCount}</Pill>
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
                <Pill tone={followUpsDue ? 'amber' : 'emerald'}>{followUpsDue}</Pill>
              </div>
            </div>
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
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', zIndex: 200, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '24px', overflowY: 'auto' }} role="presentation" onClick={() => setShowBillOfSale(false)}>
            <div style={{ background: '#fff', color: '#111', maxWidth: '680px', width: '100%', borderRadius: '8px', boxShadow: '0 4px 32px rgba(0,0,0,0.4)' }} role="dialog" aria-modal="true" aria-label="Bill of Sale" onClick={(e) => e.stopPropagation()}>
              <div style={{ padding: '16px 24px', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8f8f8', borderRadius: '8px 8px 0 0' }}>
                <strong style={{ fontSize: '15px', color: '#111' }}>Bill of Sale</strong>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    type="button"
                    style={{ padding: '6px 14px', borderRadius: '6px', background: '#1a56db', color: '#fff', border: 'none', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}
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
                  <button
                    type="button"
                    // eslint-disable-next-line jsx-a11y/no-autofocus
                    autoFocus
                    style={{ padding: '6px 14px', borderRadius: '6px', background: '#f0f0f0', color: '#333', border: '1px solid #ccc', fontSize: '13px', cursor: 'pointer' }}
                    onClick={() => setShowBillOfSale(false)}
                  >
                    Close
                  </button>
                </div>
              </div>
              <div ref={billOfSaleRef} style={{ padding: '32px', fontFamily: 'Georgia, serif', fontSize: '14px', lineHeight: '1.7', color: '#111' }}>
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
