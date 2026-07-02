import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ConfirmActionDialog } from '@/components/ConfirmActionDialog';
import { ContextMenu } from '@/components/ContextMenu';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, PageHeader, Panel, Pill } from '@/components/app-ui';
import { buildPublicShareUrl, openFacebookShareDialog } from '@/lib/facebookSharing';
import { isFacebookSharingConfigured } from '@/lib/platformConfig';
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
  const [publicLinkPending, setPublicLinkPending] = useState<{ horseId: string; horseName: string; packetStatus: string } | null>(null);
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
  const copyShareLink = async (horseId: string, path: string, listing?: SharedListingRecord) => {
    const release = await recordSharedChannel(horseId, 'Direct Link');
    if (!release.ok) {
      pushToast({ title: 'Listing link blocked', message: release.message, tone: 'error' });
      return;
    }
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
        title: 'Listing link copied',
        message: 'The protected listing link is ready to paste.',
        tone: 'success',
      });
    } catch (error) {
      console.error('Copy share link failed', error);
      pushToast({
        title: 'Copy failed',
        message: 'The listing link could not be copied.',
        tone: 'error',
      });
    }
  };

  // Public exposure is a legal-grade action: it goes through a proof-checked
  // dialog (state below) instead of window.confirm.

  const menuItems = menuHorse && menuPacket
    ? [
        {
          id: 'open-horse',
          label: 'Open horse profile',
          onSelect: () => navigate(`/horses/${menuHorse.id}`),
        },
        {
          id: 'open-share',
          label: 'Open listing',
          onSelect: async () => {
            const result = await recordSharedChannel(menuHorse.id, 'Direct Link');
            if (!result.ok) {
              pushToast({ title: 'Listing blocked', message: result.message, tone: 'error' });
              return;
            }
            if (typeof window !== 'undefined') {
              window.open(buildPublicShareUrl(menuPacket.sharePath, getShareToken(menuListing)), '_blank', 'noopener,noreferrer');
            }
          },
        },
        {
          id: 'copy-link',
          label: 'Copy listing link',
          onSelect: () => {
            void copyShareLink(menuHorse.id, menuPacket.sharePath, menuListing);
          },
        },
        ...(menuListing
          ? [
              {
                id: 'toggle-access',
                label: menuListing.accessMode === 'Private Token' ? 'Make public' : 'Require token',
                onSelect: async () => {
                  const nextAccessMode = menuListing.accessMode === 'Private Token' ? 'Public Link' : 'Private Token';
                  if (nextAccessMode === 'Public Link') {
                    setPublicLinkPending({
                      horseId: menuHorse.id,
                      horseName: menuHorse.name,
                      packetStatus: menuPacket.buyerProfileStatus,
                    });
                    return;
                  }

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
            const release = await recordSharedChannel(menuHorse.id, 'Facebook');
            if (!release.ok) {
              pushToast({ title: 'Facebook share blocked', message: release.message, tone: 'error' });
              return;
            }
            const result = openFacebookShareDialog(menuPacket.sharePath, getShareToken(menuListing));
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
        eyebrow="Sale documents"
        title="Sale listings"
      />

      <div className="metric-grid">
        <MetricCard label="Sale documents" value={`${activeSharedListings.length}`} detail="Active links" tone="blue" />
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

        <Panel eyebrow="Listings" title="Active listings">
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
                    role="button"
                    tabIndex={0}
                    onClick={() => navigate(packet.sharePath)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(packet.sharePath); } }}
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
                        to={`/horses/${horse.id}`}
                        onClick={(event) => {
                          event.stopPropagation();
                        }}
                      >
                        Open record
                      </Link>
                      <a
                        className="button button--ghost button--compact"
                        href={publicShareUrl}
                        target="_blank"
                        rel="noreferrer"
                        onClick={async (event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          const result = await recordSharedChannel(horse.id, 'Direct Link');
                          if (!result.ok) {
                            pushToast({ title: 'Listing blocked', message: result.message, tone: 'error' });
                            return;
                          }
                          if (typeof window !== 'undefined') window.open(publicShareUrl, '_blank', 'noopener,noreferrer');
                        }}
                      >
                        Open listing
                      </a>
                      <button
                        className="button button--ghost button--compact"
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void copyShareLink(horse.id, packet.sharePath, sharedListing);
                        }}
                      >
                        Copy link
                      </button>
                      <button
                        className="button button--primary button--compact"
                        type="button"
                        onClick={async (event) => {
                          event.stopPropagation();
                          const release = await recordSharedChannel(horse.id, 'Facebook');
                          if (!release.ok) {
                            pushToast({ title: 'Facebook share blocked', message: release.message, tone: 'error' });
                            return;
                          }
                          const result = openFacebookShareDialog(packet.sharePath, getShareToken(sharedListing));
                          pushToast({
                            title: result.ok ? 'Facebook ready' : 'Facebook unavailable',
                            message: result.message,
                            tone: result.ok ? 'success' : 'error',
                          });
                        }}
                      >
                        {isFacebookSharingConfigured() ? 'Post to Facebook' : 'Facebook not configured'}
                      </button>
                      {sharedListing ? (
                        <button
                          className="button button--ghost button--compact"
                          type="button"
                          onClick={async (event) => {
                            event.stopPropagation();
                            const nextAccessMode = sharedListing.accessMode === 'Private Token' ? 'Public Link' : 'Private Token';
                            if (nextAccessMode === 'Public Link') {
                              setPublicLinkPending({
                                horseId: horse.id,
                                horseName: horse.name,
                                packetStatus: packet.buyerProfileStatus,
                              });
                              return;
                            }

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
            <EmptyState compact title="No sale packets" description="Add a horse to sale packets from the horse ledger or profile." />
          )}
        </Panel>
      </div>

      <ConfirmActionDialog
        open={Boolean(publicLinkPending)}
        tone="legal"
        title={`Make ${publicLinkPending?.horseName ?? 'this listing'} publicly viewable`}
        consequences={[
          'Anyone with the link can view the sale packet without a token.',
          'Shared fields include horse identity, approved sale photos, sale readiness, and approved packet documents only.',
          'The access change is recorded in the audit log.',
        ]}
        proofSummary={<span>Current packet status: <strong>{publicLinkPending?.packetStatus ?? 'Unknown'}</strong></span>}
        acknowledgements={['I understand anyone with the link can view this packet without signing in.']}
        confirmLabel="Make public"
        onCancel={() => setPublicLinkPending(null)}
        onConfirm={() => {
          const pending = publicLinkPending;
          setPublicLinkPending(null);
          if (!pending) return;
          void updateSharedListingAccessMode(pending.horseId, 'Public Link').then((result) => {
            pushToast({
              title: result.ok ? 'Access updated' : 'Access blocked',
              message: result.message,
              tone: result.ok ? 'success' : 'error',
            });
          });
        }}
      />

      <ContextMenu open={Boolean(menuItems.length)} x={menuState?.x ?? 0} y={menuState?.y ?? 0} items={menuItems} onClose={() => setMenuState(null)} />
    </>
  );
}
