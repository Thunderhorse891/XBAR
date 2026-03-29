import { Link, useParams } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { HorseMediaPreview } from '@/components/HorseMediaPreview';
import { SalePacketSlots } from '@/components/SalePacketSlots';
import { KeyValue, MetricCard, Panel, Pill } from '@/components/app-ui';
import { buildPublicShareUrl, openFacebookShareDialog } from '@/lib/facebookSharing';
import { formatCompactCurrency, formatPercent } from '@/lib/format';
import { buildDocumentTrustProfile, buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { useUiStore } from '@/store/useUiStore';
import { useHorseRecord, useXbarStore } from '@/store/useXbarStore';

export default function BuyerProfile() {
  const { id } = useParams<{ id: string }>();
  const horse = useHorseRecord(id);
  const pushToast = useUiStore((state) => state.pushToast);
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents.filter((document) => document.horseId === id));
  const ownershipRecord = useXbarStore((state) => state.ownershipRecords.find((record) => record.horseId === id));

  if (!horse) {
    return (
      <main className="buyer-shell">
        <div className="buyer-shell__inner">
          <Panel title="Buyer profile unavailable" description="Record not found in this workspace.">
            <Link className="button button--ghost" to="/horses">
              Back to horses
            </Link>
          </Panel>
        </div>
      </main>
    );
  }

  const packet = buildHorsePacketCompleteness(horse, documents, ownershipRecord);
  const publicShareUrl = buildPublicShareUrl(packet.sharePath);
  const visibleDocuments = documents
    .map((document) => ({
      document,
      trust: buildDocumentTrustProfile(document, horses),
    }))
    .filter(({ trust }) => trust.readyForProfile);
  const salePhotoAssets = horse.gallery.filter(
    (asset) => asset.status === 'Approved' && (asset.kind === 'Hero' || asset.kind === 'Conformation' || asset.kind === 'Sale Still'),
  ).slice(0, 4);

  return (
    <main className="buyer-shell">
      <div className="buyer-shell__inner">
        <Link className="inline-link" to={`/horses/${horse.id}`}>
          Back to horse workspace
        </Link>

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
                  const result = openFacebookShareDialog(packet.sharePath);
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




