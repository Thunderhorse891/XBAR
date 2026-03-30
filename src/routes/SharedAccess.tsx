import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { buildPublicShareUrl, openFacebookShareDialog } from '@/lib/facebookSharing';
import { buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import type { SharedListingRecord } from '@/types/xbar';

export default function SharedAccess() {
  const navigate = useNavigate();
  const pushToast = useUiStore((state) => state.pushToast);
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const sharedListings = useXbarStore((state) => state.sharedListings);
  const recordSharedChannel = useXbarStore((state) => state.recordSharedChannel);
  const rotateSharedListingToken = useXbarStore((state) => state.rotateSharedListingToken);
  const updateSharedListingAccessMode = useXbarStore((state) => state.updateSharedListingAccessMode);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const [menuState, setMenuState] = useState<{ horseId: string; x: number; y: number } | null>(null);
  const activeSharedListings = sharedListings.filter((listing) => listing.state !== 'Archived');
  const liveSharedListings = activeSharedListings.filter((listing) => listing.state === 'Live');
  const facebookSharedListings = activeSharedListings.filter((listing) => listing.channels.includes('Facebook'));
  const openSharedLeads = salesLeads.filter(
    (lead) => lead.stage !== 'Closed' && activeSharedListings.some((listing) => listing.horseId === lead.horseId),
  );
  const sharedHorses = horses.filter((horse) => activeSharedListings.some((listing) => listing.horseId === horse.id));
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
  const menuHorse = sharedHorses.find((horse) => horse.id === menuState?.horseId);
  const menuPacket = menuHorse ? packetByHorseId[menuHorse.id] : undefined;
  const menuListing = menuHorse ? activeSharedListings.find((listing) => listing.horseId === menuHorse.id) : undefined;

  const getShareToken = (listing: SharedListingRecord | undefined) => (listing?.accessMode === 'Private Token' ? listing.shareToken : undefined);
  const copyShareLink = async (path: string, listing?: SharedListingRecord) => {
    const url = buildPublicShareUrl(path, getShareToken(listing));
    if (!navigator?.clipboard?.writeText) {
      pushToast({
        title: 'Copy unavailable',
        message: 'Clipboard access is not available in this browser.',
        tone: 'error',
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(url);
      pushToast({
        title: 'Buyer link copied',
        message: 'The protected buyer link is ready to paste.',
        tone: 'success',
      });
    } catch (error) {
      console.error('Copy share link failed', error);
      pushToast({
        title: 'Copy failed',
        message: 'The buyer link could not be copied.',
        tone: 'error',
      });
    }
  };

  const menuItems = menuHorse && menuPacket
    ? [
        {
          id: 'open-horse',
          label: 'Open horse profile',
          onSelect: () => navigate(`/horses/${menuHorse.id}`),
        },
        {
          id: 'open-share',
          label: 'Preview buyer room',
          onSelect: async () => {
            await recordSharedChannel(menuHorse.id, 'Direct Link');
            navigate(menuPacket.sharePath, { state: { internalPreview: true } });
          },
        },
        {
          id: 'copy-link',
          label: 'Copy buyer link',
          onSelect: () => {
            void copyShareLink(menuPacket.sharePath, menuListing);
          },
        },
        ...(menuListing
          ? [
              {
                id: 'toggle-access',
                label: menuListing.accessMode === 'Private Token' ? 'Make public' : 'Require token',
                onSelect: async () => {
                  const nextAccessMode = menuListing.accessMode === 'Private Token' ? 'Public Link' : 'Private Token';
                  const result = await updateSharedListingAccessMode(menuHorse.id, nextAccessMode);
                  pushToast({
                    title: result.ok ? 'Access updated' : 'Access blocked',
                    message: result.message,
                    tone: result.ok ? 'success' : 'error',
                  });
                },
              },
              ...(menuListing.accessMode === 'Private Token'
                ? [
                    {
                      id: 'rotate-token',
                      label: 'Rotate token',
                      onSelect: async () => {
                        const result = await rotateSharedListingToken(menuHorse.id);
                        pushToast({
                          title: result.ok ? 'Token rotated' : 'Token blocked',
                          message: result.message,
                          tone: result.ok ? 'success' : 'error',
                        });
                      },
                    },
                  ]
                : []),
            ]
          : []),
        {
          id: 'post-facebook',
          label: 'Post to Facebook',
          onSelect: async () => {
            const result = openFacebookShareDialog(menuPacket.sharePath, getShareToken(menuListing));
            if (result.ok) {
              await recordSharedChannel(menuHorse.id, 'Facebook');
            }
            pushToast({
              title: result.ok ? 'Facebook ready' : 'Facebook unavailable',
              message: result.message,
              tone: result.ok ? 'success' : 'error',
            });
          },
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
        <MetricCard label="Shared records" value={`${activeSharedListings.length}`} detail="Active links" tone="blue" />
        <MetricCard label="Live links" value={`${liveSharedListings.length}`} detail="Open to buyers" tone="emerald" />
        <MetricCard label="Facebook posts" value={`${facebookSharedListings.length}`} detail="Sent through Facebook" tone="slate" />
        <MetricCard label="Open inquiries" value={`${openSharedLeads.length}`} detail="Leads tied to shared horses" tone="amber" />
      </div>

      <div className="dashboard-grid dashboard-grid--primary">
        <Panel eyebrow="Distribution" title="Links">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Live</div>
                <Pill tone={liveSharedListings.length ? 'emerald' : 'slate'}>{liveSharedListings.length}</Pill>
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Draft</div>
                <Pill tone={activeSharedListings.length - liveSharedListings.length ? 'blue' : 'slate'}>
                  {activeSharedListings.length - liveSharedListings.length}
                </Pill>
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Channels</div>
                <Pill tone={facebookSharedListings.length ? 'blue' : 'slate'}>
                  {facebookSharedListings.length ? 'Direct + Facebook' : 'Direct link'}
                </Pill>
              </div>
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Listings" title="Shared horses">
          {sharedHorses.length ? (
            <div className="stack-list">
              {sharedHorses.map((horse) => {
                const packet = packetByHorseId[horse.id];
                const sharedListing = activeSharedListings.find((listing) => listing.horseId === horse.id);
                const publicShareUrl = buildPublicShareUrl(packet.sharePath, getShareToken(sharedListing));

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
                        <Pill tone={sharedListing?.state === 'Live' ? 'emerald' : 'blue'}>{sharedListing?.state ?? horse.sale.listingState}</Pill>
                        <Pill tone={sharedListing?.accessMode === 'Public Link' ? 'emerald' : 'slate'}>
                          {sharedListing?.accessMode ?? 'Private Token'}
                        </Pill>
                      </div>
                    </div>
                    <div className="inline-metrics">
                      <span>{horse.sale.watchlistCount} watchers</span>
                      <span>{packet.trustSummary}</span>
                      <span>{sharedListing?.channels.join(' · ') ?? 'Direct Link'}</span>
                    </div>
                    <div className="inline-actions">
                      <Link
                        className="button button--ghost button--compact"
                        to={packet.sharePath}
                        state={{ internalPreview: true }}
                        onClick={async (event) => {
                          event.stopPropagation();
                          await recordSharedChannel(horse.id, 'Direct Link');
                        }}
                      >
                        Open share link
                      </Link>
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
                      <button
                        className="button button--ghost button--compact"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void copyShareLink(packet.sharePath, sharedListing);
                        }}
                      >
                        Copy link
                      </button>
                      <button
                        className="button button--primary button--compact"
                        type="button"
                        onClick={async (event) => {
                          event.stopPropagation();
                          const result = openFacebookShareDialog(packet.sharePath, getShareToken(sharedListing));
                          if (result.ok) {
                            await recordSharedChannel(horse.id, 'Facebook');
                          }
                          pushToast({
                            title: result.ok ? 'Facebook ready' : 'Facebook unavailable',
                            message: result.message,
                            tone: result.ok ? 'success' : 'error',
                          });
                        }}
                      >
                        Post to Facebook
                      </button>
                      {sharedListing ? (
                        <button
                          className="button button--ghost button--compact"
                          type="button"
                          onClick={async (event) => {
                            event.stopPropagation();
                            const nextAccessMode = sharedListing.accessMode === 'Private Token' ? 'Public Link' : 'Private Token';
                            const result = await updateSharedListingAccessMode(horse.id, nextAccessMode);
                            pushToast({
                              title: result.ok ? 'Access updated' : 'Access blocked',
                              message: result.message,
                              tone: result.ok ? 'success' : 'error',
                            });
                          }}
                        >
                          {sharedListing.accessMode === 'Private Token' ? 'Make public' : 'Require token'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState compact title="No shared horses" description="Add a horse to shared access from the horse ledger or profile." />
          )}
        </Panel>
      </div>

      <ContextMenu open={Boolean(menuItems.length)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}
