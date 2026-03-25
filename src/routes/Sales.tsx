import { Link } from 'react-router-dom';
import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { formatCompactCurrency } from '@/lib/format';
import { buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { useXbarStore } from '@/store/useXbarStore';

export default function Sales() {
  const horses = useXbarStore((state) => state.horses);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const portal = useXbarStore((state) => state.portal);
  const documents = useXbarStore((state) => state.documents);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const saleHorses = horses.filter(
    (horse) => horse.sale.askPrice > 0 || horse.sale.listingState === 'Buyer Review' || horse.sale.listingState === 'Market Ready',
  );

  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Sales and listing readiness"
        description="Buyer flow, packets, listing trust."
      />

      <div className="metric-grid">
        <MetricCard label="Sale horses" value={`${saleHorses.length}`} detail="Profiles carrying active pricing or buyer-review posture" />
        <MetricCard label="Buyer pipeline" value={`${salesLeads.length}`} detail="Leads across social, referral, and direct inquiry channels" tone="blue" />
        <MetricCard label="Watchlist demand" value={`${portal.savedHorses}`} detail="Saved horses are now a first-class signal inside the platform" tone="emerald" />
        <MetricCard label="Transfer blockers" value={`${saleHorses.filter((horse) => horse.readiness.packetStatus === 'Needs Transfer Docs').length}`} detail="Listings with ownership or paperwork friction" tone="amber" />
      </div>

      <div className="interaction-note">
        Hover metrics and headings for full context. Use this page for listing posture, buyer flow, and packet visibility rather than hidden quick-action menus.
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Listing portfolio" title="Sale-ready horse presentation" description="Profiles below now behave like premium sales assets, not just bare horse cards.">
          <div className="horse-grid">
            {saleHorses.map((horse) => (
              <div key={horse.id} className="horse-card">
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
        </Panel>

        <Panel eyebrow="Leads" title="Buyer and inquiry flow" description="Lead capture, saved listings, and owner-facing handoff are visible here. Social login is not connected yet.">
          <div className="stack-list">
            {salesLeads.map((lead) => {
              const horse = horses.find((item) => item.id === lead.horseId);
              return (
                <div key={lead.id} className="stack-item">
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
                    <span>Last touch {lead.lastTouch}</span>
                  </div>
                </div>
              );
            })}
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
                  {portal.facebookAuthReady ? 'Connected' : 'Not connected'}
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
                  {portal.googleAuthReady ? 'Connected' : 'Not connected'}
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
    </>
  );
}
