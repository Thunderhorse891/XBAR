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
            label: 'Open horse profile',
            onSelect: () => navigate(`/horses/${menuHorse.id}`),
          },
          {
            id: 'preview-profile',
            label: 'Preview buyer profile',
            onSelect: () => navigate(`/profiles/${menuHorse.id}`),
          },
        ]
      : [];

  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Sales and listing readiness"
        description="Buyer flow, packets, listing trust."
      />

      <div className="metric-grid">
        <MetricCard label="Sale horses" value={`${saleHorses.length}`} detail="Profiles carrying active pricing or buyer-review posture" />
        <MetricCard label="Buyer pipeline" value={`${salesLeads.filter((lead) => lead.stage !== 'Closed').length}`} detail="Leads across social, referral, and direct inquiry channels" tone="blue" />
        <MetricCard label="Watchlist demand" value={`${portal.savedHorses}`} detail="Saved horses are now a first-class signal inside the platform" tone="emerald" />
        <MetricCard label="Transfer blockers" value={`${saleHorses.filter((horse) => horse.readiness.packetStatus === 'Needs Transfer Docs').length}`} detail="Listings with ownership or paperwork friction" tone="amber" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Listing portfolio" title="Sale-ready horse presentation" description="Profiles below now behave like premium sales assets, not just bare horse cards.">
          {saleHorses.length ? (
            <div className="horse-grid">
              {saleHorses.map((horse) => (
                <div
                  key={horse.id}
                  className="horse-card"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenuState({ type: 'horse', id: horse.id, x: event.clientX, y: event.clientY });
                  }}
                >
                  {(() => {
                    const packet = buildHorsePacketCompleteness(
                      horse,
                      documents.filter((document) => document.horseId === horse.id),
                      ownershipRecords.find((record) => record.horseId === horse.id),
                    );

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
                            <Link className="button button--ghost button--compact" to={packet.sharePath}>
                              Preview buyer profile
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
            <EmptyState compact title="No sale horses yet" description="Move a horse into buyer review or market ready status to populate the sales board." />
          )}
        </Panel>

        <Panel eyebrow="Leads" title="Buyer and inquiry flow" description="Lead capture, saved listings, and owner-facing handoff are visible here. Social login is not connected yet.">
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
                      <span>{lead.savedListing ? 'Saved listing' : 'No saved listing yet'}</span>
                      <span>{lead.ownerPortalReady ? 'Portal link issued' : 'Portal handoff staged'}</span>
                      <span>Last touch {formatDateLabel(lead.lastTouch)}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState compact title="No leads yet" description="Create a lead from a horse profile to start working the buyer pipeline." />
          )}
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Lead lifecycle" title={selectedLead ? `${selectedLead.name} pipeline controls` : 'Lead lifecycle'} description="Move the lead, set follow-up timing, and capture notes or offer posture from here.">
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

        <Panel eyebrow="Preview mode" title="Social and portal handoff" description="These connectors are still preview surfaces until external auth and syndication are wired.">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div>
                  <div className="stack-item__title">Facebook listing handoff</div>
                  <div className="stack-item__copy">Preview only. Real Meta publishing and lead ingestion are not connected yet.</div>
                </div>
                <Pill tone={portal.facebookAuthReady ? 'emerald' : 'amber'}>
                  {portal.facebookAuthReady ? 'Connected' : 'Preview only'}
                </Pill>
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div>
                  <div className="stack-item__title">Google and owner portal access</div>
                  <div className="stack-item__copy">External login is not connected. Buyer profile previews still work locally.</div>
                </div>
                <Pill tone={portal.googleAuthReady ? 'emerald' : 'amber'}>
                  {portal.googleAuthReady ? 'Connected' : 'Preview only'}
                </Pill>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel
          eyebrow="Connectors"
          title="Social connectors and portal syndication"
          description="This keeps Facebook and Google selling status visible inside Sales instead of hiding it only in the owner portal module."
        >
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div>
                  <div className="stack-item__title">Facebook listing handoff</div>
                  <div className="stack-item__copy">Meta-facing listing distribution and buyer capture posture.</div>
                </div>
                <Pill tone={portal.facebookAuthReady ? 'emerald' : 'amber'}>
                  {portal.facebookAuthReady ? 'Connected' : 'Preview only'}
                </Pill>
              </div>
              <div className="inline-metrics">
                <span>{portal.savedHorses} horses already eligible for social packet flows</span>
                <span>{salesLeads.filter((lead) => lead.channel === 'Facebook').length} Facebook-sourced leads</span>
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div>
                  <div className="stack-item__title">Google and owner portal access</div>
                  <div className="stack-item__copy">Buyer-safe review access for shared packets, favorites, and inquiry follow-up.</div>
                </div>
                <Pill tone={portal.googleAuthReady ? 'emerald' : 'blue'}>
                  {portal.googleAuthReady ? 'Connected' : 'Preview only'}
                </Pill>
              </div>
              <div className="inline-metrics">
                <span>{portal.openInquiries} open inquiries</span>
                <span>{portal.activeOwners} active external users staged</span>
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          eyebrow="Packet posture"
          title="Share-ready listing coverage"
          description="A quick selling view of which horses are visually ready for portal, social, and buyer review motion."
        >
          <div className="stack-list">
            {saleHorses.slice(0, 4).map((horse) => {
              const packet = buildHorsePacketCompleteness(
                horse,
                documents.filter((document) => document.horseId === horse.id),
                ownershipRecords.find((record) => record.horseId === horse.id),
              );

              return (
                <div key={horse.id} className="stack-item">
                  <div className="stack-item__top">
                    <div>
                      <div className="stack-item__title">{horse.name}</div>
                      <div className="stack-item__copy">{horse.documents.length} documents · {horse.gallery.length} media assets</div>
                    </div>
                    <Pill tone={packet.buyerProfileTone}>{packet.buyerProfileStatus}</Pill>
                  </div>
                  <div className="inline-metrics">
                    <span>{horse.sale.watchlistCount} watchers</span>
                    <span>{horse.sale.inquiryCount} inquiries</span>
                    <span>{packet.score}% packet trust</span>
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      <ContextMenu open={Boolean(menuState)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}
