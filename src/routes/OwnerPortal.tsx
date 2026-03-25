import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { useXbarStore } from '@/store/useXbarStore';

export default function OwnerPortal() {
  const portal = useXbarStore((state) => state.portal);
  const horses = useXbarStore((state) => state.horses);
  const savedHorseIds = useXbarStore((state) => state.savedHorseIds);

  return (
    <>
      <PageHeader
        eyebrow="Owner portal"
        title="Owner and buyer access"
        description="This page holds external access posture, saved horses, invite counts, and inquiry traffic. Google and Facebook login are not connected yet."
      />

      <div className="metric-grid">
        <MetricCard label="Invited owners" value={`${portal.invitedOwners}`} detail={`${portal.activeOwners} already active in the current workspace`} />
        <MetricCard label="Saved horses" value={`${portal.savedHorses}`} detail="Behavior signal available to the sales and ownership layers" tone="blue" />
        <MetricCard label="Open inquiries" value={`${portal.openInquiries}`} detail="Buyer and owner requests waiting on response" tone="amber" />
        <MetricCard label="Shared horses" value={`${savedHorseIds.length}`} detail="Profiles currently mirrored into external-facing flows" tone="emerald" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Auth providers" title="Google and Facebook status">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Google login</div>
                <Pill tone={portal.googleAuthReady ? 'emerald' : 'amber'}>{portal.googleAuthReady ? 'Connected' : 'Not connected'}</Pill>
              </div>
              <div className="stack-item__copy">Provider contract and role mapping can land here later, but the live login flow is not wired yet.</div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Facebook login</div>
                <Pill tone={portal.facebookAuthReady ? 'emerald' : 'amber'}>{portal.facebookAuthReady ? 'Connected' : 'Not connected'}</Pill>
              </div>
              <div className="stack-item__copy">Meta-facing buyer access can connect here later without changing the rest of the app shell.</div>
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Shared profiles" title="External-facing horse visibility">
          <div className="stack-list">
            {horses.filter((horse) => savedHorseIds.includes(horse.id)).map((horse) => (
              <div key={horse.id} className="stack-item">
                <div className="stack-item__top">
                  <div className="stack-item__title">{horse.name}</div>
                  <Pill tone="blue">{horse.sale.listingState}</Pill>
                </div>
                <div className="inline-metrics">
                  <span>{horse.sale.watchlistCount} watchers</span>
                  <span>{horse.sale.socialReady ? 'Share-ready packet' : 'Packet staging'}</span>
                  <span>{horse.documents.length} visible docs</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}
