import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { HorseMediaPreview } from '@/components/HorseMediaPreview';
import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { buildPublicShareUrl } from '@/lib/facebookSharing';
import { formatCompactCurrency, formatDateLabel } from '@/lib/format';
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
  const recordSharedChannel = useXbarStore((state) => state.recordSharedChannel);
  const pushToast = useUiStore((state) => state.pushToast);
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
      ]
    : menuHorse
      ? [
          {
            id: 'open-horse',
            label: 'Open horse record',
            onSelect: () => navigate(`/horses/${menuHorse.id}`),
          },
          {
            id: 'open-profile',
            label: 'Open buyer link',
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
      <PageHeader
        eyebrow="Sales"
        title="Sales"
      />

      <div className="metric-grid">
        <MetricCard label="Sale horses" value={`${saleHorses.length}`} detail="Active pricing or buyer review" />
        <MetricCard label="Buyer pipeline" value={`${salesLeads.filter((lead) => lead.stage !== 'Closed').length}`} detail="Open leads across all channels" tone="blue" />
        <MetricCard label="Shared records" value={`${sharedAccess.savedHorses}`} detail="Listings open in shared access" tone="emerald" />
        <MetricCard label="Transfer blockers" value={`${saleHorses.filter((horse) => horse.readiness.packetStatus === 'Needs Transfer Docs').length}`} detail="Listings with ownership or paperwork friction" tone="amber" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Listings" title="Listings">
          {saleHorses.length ? (
            <div className="horse-grid">
              {saleHorses.map((horse) => (
                <div
                  key={horse.id}
                  className="horse-card horse-card--interactive"
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate(`/horses/${horse.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(`/horses/${horse.id}`); } }}
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
                            <span>{packet.score}% packet trust</span>
                            <span>{packet.shareSlug}</span>
                          </div>
                          <div className="horse-card__footer">
                            <span>{horse.sale.watchlistCount} watchers</span>
                            <span>{formatCompactCurrency(horse.sale.askPrice || horse.insuredValue)}</span>
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
                              Open buyer link
                            </a>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No sale horses yet" description="Move a horse into buyer review or market ready to populate the sales board." />
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
                          {lead.channel} · {horse?.name}
                        </div>
                      </div>
                      <Pill tone={lead.stage === 'Offer' ? 'emerald' : lead.stage === 'Qualified' ? 'blue' : 'amber'}>
                        {lead.stage}
                      </Pill>
                    </div>
                    <div className="inline-metrics">
                      <span>{lead.savedListing ? 'Saved listing' : 'Not saved yet'}</span>
                      <span>{lead.shareReady ? 'Buyer link live' : 'Buyer link private'}</span>
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
    </>
  );
}
