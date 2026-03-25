import { useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import ContextMenu from '@/components/ContextMenu';
import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { formatCompactCurrency } from '@/lib/format';
import { buildHorseProfileUrl, copyTextToClipboard } from '@/lib/xbarRuntime';
import { useXbarStore } from '@/store/useXbarStore';

export default function Sales() {
  const navigate = useNavigate();
  const horses = useXbarStore((state) => state.horses);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const portal = useXbarStore((state) => state.portal);
  const savedHorseIds = useXbarStore((state) => state.savedHorseIds);
  const toggleSavedHorse = useXbarStore((state) => state.toggleSavedHorse);
  const [message, setMessage] = useState('');
  const [menuState, setMenuState] = useState<{ horseId: string; x: number; y: number } | null>(null);
  const saleHorses = horses.filter(
    (horse) => horse.sale.askPrice > 0 || horse.sale.listingState === 'Buyer Review' || horse.sale.listingState === 'Market Ready',
  );
  const menuHorse = menuState ? horses.find((horse) => horse.id === menuState.horseId) ?? null : null;

  const openHorseMenu = (event: ReactMouseEvent<HTMLDivElement>, horseId: string) => {
    event.preventDefault();
    setMenuState({ horseId, x: event.clientX, y: event.clientY });
  };

  const closeMenu = () => setMenuState(null);

  const handleCopyListingSummary = async (horseId: string) => {
    const horse = horses.find((item) => item.id === horseId);
    if (!horse) return;

    const copied = await copyTextToClipboard(
      `${horse.name} | ${horse.sale.listingState} | ${formatCompactCurrency(horse.sale.askPrice || horse.insuredValue)} | ${horse.sale.watchlistCount} watchers | ${horse.readiness.packetStatus}`,
    );
    setMessage(copied ? `${horse.name} listing summary copied.` : 'Clipboard copy was blocked by the browser.');
  };

  const handleCopyListingLink = async (horseId: string) => {
    const horse = horses.find((item) => item.id === horseId);
    if (!horse) return;

    const copied = await copyTextToClipboard(buildHorseProfileUrl(horse.id));
    setMessage(copied ? `${horse.name} listing link copied.` : 'Clipboard copy was blocked by the browser.');
  };

  const handlePortalToggle = (horseId: string) => {
    const horse = horses.find((item) => item.id === horseId);
    if (!horse) return;

    const saved = savedHorseIds.includes(horseId);
    toggleSavedHorse(horseId);
    setMessage(saved ? `${horse.name} removed from the owner-facing watchlist.` : `${horse.name} saved for portal and social follow-up.`);
  };

  return (
    <>
      <PageHeader
        eyebrow="Sales"
        title="Sales and listing readiness"
        description="The sales module now treats buyer flow, listing packets, transfer blockers, and owner portal handoff as real product surfaces."
      />

      {message ? <div className="status-banner">{message}</div> : null}

      <div className="metric-grid">
        <MetricCard label="Sale horses" value={`${saleHorses.length}`} detail="Profiles carrying active pricing or buyer-review posture" />
        <MetricCard label="Buyer pipeline" value={`${salesLeads.length}`} detail="Leads across social, referral, and direct inquiry channels" tone="blue" />
        <MetricCard label="Watchlist demand" value={`${portal.savedHorses}`} detail="Saved horses are now a first-class signal inside the platform" tone="emerald" />
        <MetricCard label="Transfer blockers" value={`${saleHorses.filter((horse) => horse.readiness.packetStatus === 'Needs Transfer Docs').length}`} detail="Listings with ownership or paperwork friction" tone="amber" />
      </div>

      <div className="interaction-note">
        Hover metrics and headings for full context. Right-click a sale card for listing actions like copying a share link or saving it into the portal.
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Listing portfolio" title="Sale-ready horse presentation" description="Profiles below now behave like premium sales assets, not just bare horse cards.">
          <div className="horse-grid">
            {saleHorses.map((horse) => (
              <div
                key={horse.id}
                className="horse-card horse-card--interactive"
                title={`${horse.name} · Right-click for listing actions`}
                onContextMenu={(event) => openHorseMenu(event, horse.id)}
              >
                <div className="horse-card__media">
                  <img src={horse.profileImage} alt="" className="horse-card__image" />
                  <div className="horse-card__media-copy">
                    <Pill tone={horse.sale.socialReady ? 'emerald' : 'amber'}>
                      {horse.sale.socialReady ? 'Packet ready' : 'Packet staged'}
                    </Pill>
                  </div>
                </div>
                <div className="horse-card__body">
                  <div className="horse-card__title">{horse.name}</div>
                  <div className="horse-card__subtitle">{horse.sale.listingState}</div>
                  <p className="horse-card__summary">{horse.summary}</p>
                  <div className="horse-card__footer">
                    <span>{horse.sale.watchlistCount} watchers</span>
                    <span>{formatCompactCurrency(horse.sale.askPrice || horse.insuredValue)}</span>
                  </div>
                </div>
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
          description="This makes the Facebook and Google selling foundation visible inside Sales instead of hiding it only in the owner portal module."
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
            {saleHorses.slice(0, 4).map((horse) => (
              <div key={horse.id} className="stack-item">
                <div className="stack-item__top">
                  <div>
                    <div className="stack-item__title">{horse.name}</div>
                    <div className="stack-item__copy">{horse.documents.length} documents · {horse.gallery.length} media assets</div>
                  </div>
                  <Pill tone={horse.sale.socialReady ? 'emerald' : 'amber'}>
                    {horse.sale.socialReady ? 'Share-ready' : 'Needs packet work'}
                  </Pill>
                </div>
                <div className="inline-metrics">
                  <span>{horse.sale.watchlistCount} watchers</span>
                  <span>{horse.sale.inquiryCount} inquiries</span>
                  <span>{horse.readiness.packetStatus}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      {menuState && menuHorse ? (
        <ContextMenu
          x={menuState.x}
          y={menuState.y}
          onClose={closeMenu}
          options={[
            {
              label: 'Open horse profile',
              hint: 'Jump into the full record before sharing',
              action: () => navigate(`/horses/${menuHorse.id}`),
            },
            {
              label: 'Copy listing link',
              hint: 'Share the horse profile route',
              action: () => {
                void handleCopyListingLink(menuHorse.id);
              },
            },
            {
              label: 'Copy packet summary',
              hint: 'Price, watchers, and packet posture',
              action: () => {
                void handleCopyListingSummary(menuHorse.id);
              },
            },
            {
              label: savedHorseIds.includes(menuHorse.id) ? 'Remove from portal saved' : 'Save into portal',
              hint: 'Keep this listing visible for owner and buyer flows',
              action: () => handlePortalToggle(menuHorse.id),
            },
          ]}
        />
      ) : null}
    </>
  );
}
