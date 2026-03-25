import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { useXbarStore } from '@/store/useXbarStore';

export default function OwnerPortal() {
  const portal = useXbarStore((state) => state.portal);
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const savedHorseIds = useXbarStore((state) => state.savedHorseIds);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const sharedHorses = horses.filter((horse) => savedHorseIds.includes(horse.id));
  const liveProfiles = sharedHorses.filter((horse) =>
    buildHorsePacketCompleteness(
      horse,
      documents.filter((document) => document.horseId === horse.id),
      ownershipRecords.find((record) => record.horseId === horse.id),
    ).buyerSafe,
  );

  return (
    <>
      <PageHeader
        eyebrow="Owner portal"
        title="Owner and buyer access"
        description="Saved horses, buyer links, inquiry flow."
      />

      <div className="callout callout--warning">
        <strong>Preview only:</strong> External owner login, Google auth, and Facebook auth are not connected yet. Buyer profile previews and saved-horse logic are local-only in this build.
      </div>

      <div className="metric-grid">
        <MetricCard label="Invited owners" value={`${portal.invitedOwners}`} detail={`${portal.activeOwners} already active in the current workspace`} />
        <MetricCard label="Saved horses" value={`${portal.savedHorses}`} detail="Behavior signal available to the sales and ownership layers" tone="blue" />
        <MetricCard label="Open inquiries" value={`${portal.openInquiries}`} detail="Buyer and owner requests waiting on response" tone="amber" />
        <MetricCard label="Live buyer links" value={`${liveProfiles.length}`} detail="Saved horses currently clear enough for buyer-facing profile previews" tone="emerald" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Auth providers" title="Google and Facebook status">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Google login</div>
                <Pill tone={portal.googleAuthReady ? 'emerald' : 'amber'}>{portal.googleAuthReady ? 'Connected' : 'Preview only'}</Pill>
              </div>
              <div className="stack-item__copy">Provider contract and role mapping can land here later, but the live login flow is not wired yet.</div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Facebook login</div>
                <Pill tone={portal.facebookAuthReady ? 'emerald' : 'amber'}>{portal.facebookAuthReady ? 'Connected' : 'Preview only'}</Pill>
              </div>
              <div className="stack-item__copy">Meta-facing buyer access can connect here later without changing the rest of the app shell.</div>
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Shared profiles" title="External-facing horse visibility">
          {sharedHorses.length ? (
            <div className="stack-list">
              {sharedHorses.map((horse) => {
                const packet = buildHorsePacketCompleteness(
                  horse,
                  documents.filter((document) => document.horseId === horse.id),
                  ownershipRecords.find((record) => record.horseId === horse.id),
                );

                return (
                  <div key={horse.id} className="stack-item">
                    <div className="stack-item__top">
                      <div className="stack-item__title">{horse.name}</div>
                      <div className="status-inline">
                        <Pill tone={packet.buyerProfileTone}>{packet.buyerProfileStatus}</Pill>
                        <Pill tone="blue">{horse.sale.listingState}</Pill>
                      </div>
                    </div>
                    <div className="inline-metrics">
                      <span>{horse.sale.watchlistCount} watchers</span>
                      <span>{packet.trustSummary}</span>
                      <span>{horse.documents.length} visible docs</span>
                    </div>
                    <div className="inline-actions">
                      <Link className="button button--ghost button--compact" to={packet.sharePath}>
                        Preview share link
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState compact title="No saved horses to share" description="Save a horse to the portal from the horse ledger or profile to preview buyer-facing access here." />
          )}
        </Panel>
      </div>
    </>
  );
}
