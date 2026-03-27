import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { useXbarStore } from '@/store/useXbarStore';

export default function SharedAccess() {
  const navigate = useNavigate();
  const sharedAccess = useXbarStore((state) => state.sharedAccess);
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const savedHorseIds = useXbarStore((state) => state.savedHorseIds);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const [menuState, setMenuState] = useState<{ horseId: string; x: number; y: number } | null>(null);
  const sharedHorses = horses.filter((horse) => savedHorseIds.includes(horse.id));
  const packetByHorseId = useMemo(
    () =>
      Object.fromEntries(
        sharedHorses.map((horse) => [
          horse.id,
          buildHorsePacketCompleteness(
            horse,
            documents.filter((document) => document.horseId === horse.id),
            ownershipRecords.find((record) => record.horseId === horse.id),
          ),
        ]),
      ),
    [documents, ownershipRecords, sharedHorses],
  );
  const liveProfiles = sharedHorses.filter((horse) => packetByHorseId[horse.id]?.buyerSafe);
  const menuHorse = sharedHorses.find((horse) => horse.id === menuState?.horseId);
  const menuPacket = menuHorse ? packetByHorseId[menuHorse.id] : undefined;
  const menuItems = menuHorse && menuPacket
    ? [
        {
          id: 'open-horse',
          label: 'Open horse profile',
          onSelect: () => navigate(`/horses/${menuHorse.id}`),
        },
        {
          id: 'open-share',
          label: 'Open share link',
          onSelect: () => navigate(menuPacket.sharePath),
        },
      ]
    : [];

  return (
    <>
      <PageHeader
        eyebrow="Shared access"
        title="Shared Access"
      />

      <div className="metric-grid">
        <MetricCard label="Invited owners" value={`${sharedAccess.invitedOwners}`} detail={`${sharedAccess.activeOwners} active`} />
        <MetricCard label="Saved horses" value={`${sharedAccess.savedHorses}`} detail="Demand signal" tone="blue" />
        <MetricCard label="Open inquiries" value={`${sharedAccess.openInquiries}`} detail="Waiting on response" tone="amber" />
        <MetricCard label="Live buyer links" value={`${liveProfiles.length}`} detail="Ready to share" tone="emerald" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Access" title="Links">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Mode</div>
                <Pill tone="blue">Shared links</Pill>
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Inquiries</div>
                <Pill tone="amber">{sharedAccess.openInquiries} open</Pill>
              </div>
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Shared records" title="Saved horses">
          {sharedHorses.length ? (
            <div className="stack-list">
              {sharedHorses.map((horse) => {
                const packet = packetByHorseId[horse.id];

                return (
                  <div
                    key={horse.id}
                    className="stack-item stack-item--interactive"
                    onClick={() => navigate(packet.sharePath)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setMenuState({ horseId: horse.id, x: event.clientX, y: event.clientY });
                    }}
                  >
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
                      <Link className="button button--ghost button--compact" to={packet.sharePath} onClick={(event) => event.stopPropagation()}>
                        Open share link
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState compact title="No saved horses to share" description="Save a horse to manage share links here." />
          )}
        </Panel>
      </div>

      <ContextMenu open={Boolean(menuItems.length)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}
