import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { HorseMediaPreview } from '@/components/HorseMediaPreview';
import { SalePacketSlots } from '@/components/SalePacketSlots';
import { KeyValue, MetricCard, Panel, Pill } from '@/components/app-ui';
import { buildPublicShareUrl, openFacebookShareDialog } from '@/lib/facebookSharing';
import { formatCompactCurrency, formatPercent } from '@/lib/format';
import { loadPublicBuyerProfile, trackPublicBuyerProfileView, type PublicBuyerProfilePayload } from '@/lib/publicShare';
import { hasBuyerShareAccess } from '@/lib/workspaceAccess';
import { buildDocumentTrustProfile, buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { useUiStore } from '@/store/useUiStore';
import { useHorseRecord, useXbarStore } from '@/store/useXbarStore';

export default function BuyerProfile() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const localHorse = useHorseRecord(id);
  const pushToast = useUiStore((state) => state.pushToast);
  const localHorses = useXbarStore((state) => state.horses);
  const localDocuments = useXbarStore((state) => state.documents.filter((document) => document.horseId === id));
  const localOwnershipRecord = useXbarStore((state) => state.ownershipRecords.find((record) => record.horseId === id));
  const localSharedListing = useXbarStore((state) => state.sharedListings.find((listing) => listing.horseId === id && listing.state !== 'Archived'));
  const shareToken = searchParams.get('t')?.trim() ?? '';
  const localAccessAllowed = hasBuyerShareAccess(localSharedListing, shareToken);
  const localPayload = useMemo(
    () =>
      localHorse && localAccessAllowed
        ? {
            horse: localHorse,
            documents: localDocuments,
            ownershipRecord: localOwnershipRecord,
            sharedListing: localSharedListing,
          }
        : undefined,
    [localAccessAllowed, localDocuments, localHorse, localOwnershipRecord, localSharedListing],
  );
  const [remoteState, setRemoteState] = useState<{
    status: 'idle' | 'loading' | 'loaded' | 'error';
    payload?: PublicBuyerProfilePayload;
    message?: string;
    source?: 'rpc' | 'local';
  }>(() => ({
    status: localPayload ? 'loaded' : 'loading',
    payload: localPayload,
    source: localPayload ? 'local' : undefined,
  }));
  const sharePath = useMemo(() => (id ? `/profiles/${id}` : ''), [id]);

  useEffect(() => {
    if (!id) {
      return;
    }

    let disposed = false;
    setRemoteState((current) => ({
      ...current,
      status: 'loading',
      message: undefined,
    }));

    void loadPublicBuyerProfile({
      sharePath,
      shareToken,
    }).then((result) => {
      if (disposed) {
        return;
      }

      if (result.ok) {
        setRemoteState({
          status: 'loaded',
          payload: result.payload,
          source: result.source,
        });
        void trackPublicBuyerProfileView({ sharePath, shareToken });
        return;
      }

      if (localPayload) {
        setRemoteState({
          status: 'loaded',
          payload: localPayload,
          source: 'local',
          message: result.message,
        });
        return;
      }

      setRemoteState({
        status: 'error',
        message: result.message,
      });
    });

    return () => {
      disposed = true;
    };
  }, [id, localPayload, sharePath, shareToken]);

  const resolvedPayload = remoteState.payload ?? localPayload;

  const horse = resolvedPayload?.horse;
  const documents = resolvedPayload?.documents ?? [];
  const ownershipRecord = resolvedPayload?.ownershipRecord;
  const sharedListing = resolvedPayload?.sharedListing;
  const matchingHorses = remoteState.source === 'local' || !remoteState.payload ? localHorses : horse ? [horse] : [];

  if (!horse) {
    const title = remoteState.status === 'loading'
      ? 'Loading buyer room'
      : localHorse && localSharedListing
        ? 'Share link locked'
        : 'Buyer profile unavailable';
    const description = remoteState.status === 'loading'
      ? 'Loading listing and packet data.'
      : localHorse && localSharedListing && !localAccessAllowed
        ? 'This buyer room requires a valid access link from the workspace.'
        : remoteState.message ?? 'Record not found in this workspace.';

    return (
      <main className="buyer-shell">
        <div className="buyer-shell__inner">
          <Panel title={title} description={description}>
            {localHorse ? (
              <Link className="button button--ghost" to="/horses">
                Back to horses
              </Link>
            ) : null}
          </Panel>
        </div>
      </main>
    );
  }

  const packet = buildHorsePacketCompleteness(horse, documents, ownershipRecord);
  const publicShareToken = sharedListing?.accessMode === 'Private Token' ? sharedListing.shareToken : undefined;
  const publicShareUrl = buildPublicShareUrl(packet.sharePath, publicShareToken);
  const visibleDocuments = documents
    .map((document) => ({
      document,
      trust: buildDocumentTrustProfile(document, matchingHorses),
    }))
    .filter(({ trust }) => trust.readyForProfile);
  const salePhotoAssets = horse.gallery.filter(
    (asset) => asset.status === 'Approved' && (asset.kind === 'Hero' || asset.kind === 'Conformation' || asset.kind === 'Sale Still'),
  ).slice(0, 4);

  return (
    <main className="buyer-shell">
      <div className="buyer-shell__inner">
        {localHorse ? (
          <Link className="inline-link" to={`/horses/${horse.id}`}>
            Back to horse workspace
          </Link>
        ) : null}

        <section className="buyer-hero">
          <div className="buyer-hero__media">
            <HorseMediaPreview
              src={horse.profileImage || horse.gallery[0]?.url}
              name={horse.name}
              imageClassName="buyer-hero__image"
              fallbackClassName="buyer-hero__image-fallback"
              emptyLabel="No media"
            />
          </div>
          <div className="buyer-hero__copy">
            <div className="eyebrow">Buyer profile</div>
            <h1 className="page-title">{horse.name}</h1>
            <div className="status-inline">
              <Pill tone={packet.buyerProfileTone}>{packet.buyerProfileStatus}</Pill>
              <Pill tone={packet.tone}>{formatPercent(packet.score)} packet trust</Pill>
              <Pill tone="blue">{horse.sale.listingState}</Pill>
              <Pill tone={sharedListing?.accessMode === 'Public Link' ? 'emerald' : 'slate'}>
                {sharedListing?.accessMode ?? 'Private Token'}
              </Pill>
            </div>
            <div className="buyer-share">
              <span>Share path</span>
              <strong>{packet.sharePath}</strong>
            </div>
            <div className="inline-actions">
              <a className="button button--ghost button--compact" href={publicShareUrl} target="_blank" rel="noreferrer">
                Open public view
              </a>
              <button
                className="button button--primary button--compact"
                type="button"
                onClick={() => {
                  const result = openFacebookShareDialog(packet.sharePath, publicShareToken);
                  pushToast({
                    title: result.ok ? 'Facebook ready' : 'Facebook unavailable',
                    message: result.message,
                    tone: result.ok ? 'success' : 'error',
                  });
                }}
              >
                Post to Facebook
              </button>
            </div>
          </div>
        </section>

        <div className="metric-grid">
          <MetricCard label="Packet trust" value={formatPercent(packet.score)} detail={packet.trustSummary} tone={packet.tone} />
          <MetricCard
            label="Buyer confidence"
            value={formatPercent(horse.sale.buyerConfidence)}
            detail="Sales posture"
            tone="blue"
          />
          <MetricCard
            label="Verified documents"
            value={`${visibleDocuments.length}`}
            detail="Ready for buyer view"
            tone="emerald"
          />
          <MetricCard
            label="Target price"
            value={formatCompactCurrency(horse.sale.askPrice || horse.insuredValue)}
            detail={`${horse.sale.watchlistCount} watchers and ${horse.sale.inquiryCount} inquiries`}
            tone="slate"
          />
        </div>

        <div className="detail-grid">
          <Panel eyebrow="Sale packet" title="Coverage">
            <SalePacketSlots slots={packet.saleSlots} />
          </Panel>

          <Panel eyebrow="Horse profile" title="Profile">
            <div className="key-grid key-grid--wide">
              <KeyValue label="Registry" value={`${horse.registry} · ${horse.registrationNumber}`} />
              <KeyValue label="Breed / sex" value={`${horse.breed} · ${horse.sex}`} />
              <KeyValue label="Age" value={`${horse.age}`} />
              <KeyValue label="Color" value={horse.color} />
              <KeyValue label="Bloodline" value={`${horse.bloodline.sire} / ${horse.bloodline.dam}`} />
              <KeyValue label="Family" value={horse.bloodline.family} />
            </div>

          </Panel>
        </div>

        <div className="detail-grid">
          <Panel eyebrow="Verified support" title="Approved docs">
            <div className="stack-list">
              {visibleDocuments.length ? (
                visibleDocuments.map(({ document, trust }) => (
                  <div key={document.id} className="stack-item">
                    <div className="stack-item__top">
                      <div>
                        <div className="stack-item__title">{document.title}</div>
                        <div className="stack-item__copy">{document.type}</div>
                      </div>
                      <Pill tone={trust.tone}>{formatPercent(trust.trustScore)} trust</Pill>
                    </div>
                    <div className="stack-item__copy">{document.summary}</div>
                  </div>
                ))
              ) : (
                <EmptyState compact title="No approved docs" description="No linked files clear the buyer-ready threshold yet." />
              )}
            </div>
          </Panel>

          <Panel eyebrow="AQHA photos" title="Photo set">
            {salePhotoAssets.length ? (
              <div className="media-strip">
                {salePhotoAssets.map((asset) => (
                  <div key={asset.id} className="media-tile">
                    <div className="media-tile__image-shell">
                      <img src={asset.url} alt={asset.label} className="media-tile__image" />
                    </div>
                    <div className="media-tile__label">{asset.label}</div>
                    <div className="media-tile__meta">
                      <span>{asset.kind}</span>
                      <Pill tone="blue">{asset.status}</Pill>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState compact title="No AQHA photos" description="Add approved hero and conformation photos before sharing." />
            )}
          </Panel>
        </div>
      </div>
    </main>
  );
}




