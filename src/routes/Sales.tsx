import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { formatCompactCurrency, formatDateLabel } from '@/lib/format';
import { useUiStore } from '@/store/useUiStore';
import { buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { useXbarStore } from '@/store/useXbarStore';

export default function Sales() {
  const navigate = useNavigate();
  const horses = useXbarStore((state) => state.horses);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const portal = useXbarStore((state) => state.portal);
  const documents = useXbarStore((state) => state.documents);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const updateSalesLead = useXbarStore((state) => state.updateSalesLead);
  const pushToast = useUiStore((state) => state.pushToast);
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
  const menuItems = menuLead
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
          label: 'Open share view',
          onSelect: () => navigate(`/profiles/${menuHorse.id}`),
        },
      ]
      : [];

  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Sales Board"
        description="Listings, buyers, follow-up."
      />

      <div className="metric-grid">
        <MetricCard label="Sale horses" value={`${saleHorses.length}`} detail="Active pricing or buyer review" />
        <MetricCard label="Buyer pipeline" value={`${salesLeads.filter((lead) => lead.stage !== 'Closed').length}`} detail="Open leads across all channels" tone="blue" />
        <MetricCard label="Watchlist demand" value={`${portal.savedHorses}`} detail="Saved horses signal live buyer interest" tone="emerald" />
        <MetricCard label="Transfer blockers" value={`${saleHorses.filter((horse) => horse.readiness.packetStatus === 'Needs Transfer Docs').length}`} detail="Listings with ownership or paperwork friction" tone="amber" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Listings" title="Sale-ready records" description="Live listings.">
          {saleHorses.length ? (
            <div className="horse-grid">
              {saleHorses.map((horse) => (
                <div
                  key={horse.id}
                  className="horse-card horse-card--interactive"
                  onClick={() => navigate(`/horses/${horse.id}`)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenuState({ type: 'horse', id: horse.id, x: event.clientX, y: event.clientY });
                  }}
                >
                  {(() => {
                    const packet = packetByHorseId[horse.id];

                    return (
                      <>
                        <div className="horse-card__media">
                          <img src={horse.profileImage} alt="" className="horse-card__image" />
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
                            <Link className="button button--ghost button--compact" to={packet.sharePath} onClick={(event) => event.stopPropagation()}>
                              Open share view
                            </Link>
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

        <Panel eyebrow="Leads" title="Buyer flow" description="Lead pipeline.">
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
                      <span>{lead.ownerPortalReady ? 'Share link issued' : 'Share link staged'}</span>
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
        <Panel eyebrow="Lead lifecycle" title={selectedLead ? `${selectedLead.name} pipeline controls` : 'Lead lifecycle'} description="Edit stage, follow-up, notes.">
          {selectedLead ? (
            <>
              <div className="form-grid form-grid--tight">
                <label className="field-stack">
                  <span className="field-label">Stage</span>
                  <select className="field-input" value={leadStage} onChange={(event) => setLeadStage(event.target.value as typeof leadStage)}>
                    {(['New', 'Qualified', 'Offer', 'Closed'] as const).map((stage) => (
                      <option key={stage} value={stage}>
                        {stage}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field-stack">
                  <span className="field-label">Last touch</span>
                  <input className="field-input" type="date" value={leadLastTouch} onChange={(event) => setLeadLastTouch(event.target.value)} />
                </label>
                <label className="field-stack">
                  <span className="field-label">Next follow-up</span>
                  <input className="field-input" type="date" value={leadNextFollowUp} onChange={(event) => setLeadNextFollowUp(event.target.value)} />
                </label>
                <label className="field-stack">
                  <span className="field-label">Offer amount</span>
                  <input className="field-input" type="number" min="0" value={leadOfferAmount} onChange={(event) => setLeadOfferAmount(event.target.value)} />
                </label>
                <label className="field-stack">
                  <span className="field-label">Closed outcome</span>
                  <select className="field-input" value={leadOutcome} onChange={(event) => setLeadOutcome(event.target.value as 'Won' | 'Lost')}>
                    <option value="Won">Won</option>
                    <option value="Lost">Lost</option>
                  </select>
                </label>
                <label className="field-stack field-stack--wide">
                  <span className="field-label">Notes</span>
                  <textarea className="field-textarea" rows={4} value={leadNotes} onChange={(event) => setLeadNotes(event.target.value)} />
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
                >
                  Save lead changes
                </button>
              </div>
            </>
          ) : (
            <EmptyState compact title="No lead selected" description="Pick a lead from the pipeline to edit its lifecycle and notes." />
          )}
        </Panel>

        <Panel eyebrow="Handoff" title="Share readiness" description="Live motion.">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div>
                  <div className="stack-item__title">Live share links</div>
                  <div className="stack-item__copy">Sale horses clean enough to open as shareable records.</div>
                </div>
                <Pill tone={liveShareCount ? 'emerald' : 'amber'}>{liveShareCount}</Pill>
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div>
                  <div className="stack-item__title">Saved demand</div>
                  <div className="stack-item__copy">Watchlist pressure from the shared-access layer.</div>
                </div>
                <Pill tone={portal.savedHorses ? 'blue' : 'slate'}>{portal.savedHorses}</Pill>
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div>
                  <div className="stack-item__title">Follow-ups due</div>
                  <div className="stack-item__copy">Leads with a next-touch date at or before today.</div>
                </div>
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
