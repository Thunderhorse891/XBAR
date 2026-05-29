import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { HorseMediaPreview } from '@/components/HorseMediaPreview';
import { SalePacketSlots } from '@/components/SalePacketSlots';
import { KeyValue, MetricCard, Panel, Pill } from '@/components/app-ui';
import { buildPublicShareUrl, openFacebookShareDialog } from '@/lib/facebookSharing';
import { formatCompactCurrency, formatPercent } from '@/lib/format';
import { isPublicShareLocalPreviewEnabled } from '@/lib/platformConfig';
import { loadPublicBuyerProfile, sanitizeDocumentForBuyerView, sanitizeHorseForBuyerView, sanitizeSharedListingForBuyerView, trackPublicBuyerProfileView, type PublicBuyerProfilePayload } from '@/lib/publicShare';
import { hasBuyerShareAccess } from '@/lib/workspaceAccess';
import { buildDocumentTrustProfile, buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { useUiStore } from '@/store/useUiStore';
import { useHorseRecord, useXbarStore } from '@/store/useXbarStore';

export default function BuyerProfile() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const localHorse = useHorseRecord(id);
  const pushToast = useUiStore((state) => state.pushToast);
  const localDocuments = useXbarStore((state) => state.documents.filter((document) => document.horseId === id));
  const localSharedListing = useXbarStore((state) => state.sharedListings.find((listing) => listing.horseId === id && listing.state !== 'Archived'));
  const shareToken = searchParams.get('t')?.trim() ?? '';
  const localPreviewAllowed = isPublicShareLocalPreviewEnabled() && searchParams.get('preview') === 'local';
  const localAccessAllowed = hasBuyerShareAccess(localSharedListing, shareToken);

  // Sanitized local preview payload — only buyer-safe fields, never raw internal records.
  const localPayload = useMemo(
    () =>
      localPreviewAllowed && localHorse && localAccessAllowed
        ? {
            horse: sanitizeHorseForBuyerView(localHorse),
            documents: localDocuments.map(sanitizeDocumentForBuyerView),
            sharedListing: localSharedListing ? sanitizeSharedListingForBuyerView(localSharedListing) : undefined,
          }
        : undefined,
    [localAccessAllowed, localDocuments, localHorse, localPreviewAllowed, localSharedListing],
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
          source: 'rpc',
        });
        void trackPublicBuyerProfileView({ sharePath, shareToken });
        return;
      }

      // Fall back to local preview only when the user is an internal workspace member
      // viewing their own horse (localPayload is always sanitized).
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
  const sharedListing = resolvedPayload?.sharedListing;

  if (!horse) {
    const title = remoteState.status === 'loading'
      ? 'Loading sale packet'
      : localPreviewAllowed && localHorse && localSharedListing
        ? 'Share link locked'
        : 'Buyer profile unavailable';
    const description = remoteState.status === 'loading'
      ? 'Loading listing and packet data.'
      : localPreviewAllowed && localHorse && localSharedListing && !localAccessAllowed
        ? 'This sale packet requires a valid access link from the ranch.'
        : remoteState.message ?? 'Record not found in this workspace.';

    return (
      <main className="buyer-shell">
        <div className="buyer-shell__inner">
          <Panel title={title} description={description}>
            {localPreviewAllowed && localHorse ? (
              <Link className="button button--ghost" to="/horses">
                Back to horses
              </Link>
            ) : null}
          </Panel>
        </div>
      </main>
    );
  }

  // Build packet completeness from the sanitized horse shape.
  // Cast to satisfy the helper signature — only uses the fields present in PublicHorseDTO.
  // Inject empty alerts — PublicHorseDTO omits them intentionally; the packet
  // scorer needs the field but buyers must never see internal alert data.
  const packet = buildHorsePacketCompleteness({ ...horse, alerts: [] } as unknown as Parameters<typeof buildHorsePacketCompleteness>[0], documents as Parameters<typeof buildHorsePacketCompleteness>[1], undefined);
  const publicShareToken = sharedListing?.accessMode === 'Private Token' ? sharedListing.shareToken : undefined;
  const publicShareUrl = buildPublicShareUrl(packet.sharePath, publicShareToken);
  const visibleDocuments = documents
    .map((document) => ({
      document,
      trust: buildDocumentTrustProfile(document as Parameters<typeof buildDocumentTrustProfile>[0], horse ? [horse as Parameters<typeof buildDocumentTrustProfile>[1][0]] : []),
    }))
    .filter(({ trust }) => trust.readyForProfile);
  const salePhotoAssets = horse.gallery.filter(
    (asset) => asset.status === 'Approved' && (asset.kind === 'Hero' || asset.kind === 'Conformation' || asset.kind === 'Sale Still'),
  ).slice(0, 4);

  return (
    <main className="buyer-shell">
      <div className="buyer-shell__inner">
        {localPreviewAllowed && localHorse ? (
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
              <Pill tone={packet.tone}>{formatPercent(packet.score)} record complete</Pill>
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
            value="—"
            detail="Buyer posture not disclosed"
            tone="slate"
          />
          <MetricCard
            label="Verified documents"
            value={`${visibleDocuments.length}`}
            detail="Ready for buyer view"
            tone="emerald"
          />
          <MetricCard
            label="Asking price"
            value={horse.sale.askPrice ? formatCompactCurrency(horse.sale.askPrice) : 'Contact seller'}
            detail="Contact ranch for financing options"
            tone="slate"
          />
        </div>

        <div className="detail-grid">
          <Panel eyebrow="Sale packet" title="Coverage">
            <SalePacketSlots slots={packet.saleSlots} />
          </Panel>

          <Panel eyebrow="Horse profile" title="Profile">
            <div className="key-grid key-grid--wide">
              {horse.registry || horse.registrationNumber ? (
                <KeyValue label="Registry" value={`${horse.registry}${horse.registrationNumber ? ` · ${horse.registrationNumber}` : ''}`} />
              ) : null}
              <KeyValue label="Breed / sex" value={[horse.breed, horse.sex].filter(Boolean).join(' · ') || '—'} />
              {horse.age > 0 ? <KeyValue label="Age" value={`${horse.age}`} /> : null}
              {horse.color ? <KeyValue label="Color" value={horse.color} /> : null}
              {(horse.bloodline.sire || horse.bloodline.dam) ? (
                <KeyValue label="Bloodline" value={`${horse.bloodline.sire || '—'} / ${horse.bloodline.dam || '—'}`} />
              ) : null}
              {horse.bloodline.family ? <KeyValue label="Family" value={horse.bloodline.family} /> : null}
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
                      <Pill tone={trust.tone}>{formatPercent(trust.trustScore)} complete</Pill>
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
