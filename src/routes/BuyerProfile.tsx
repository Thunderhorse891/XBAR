import { Link, useParams } from 'react-router-dom';
import { KeyValue, MetricCard, Panel, Pill, ProgressBar } from '@/components/app-ui';
import { formatCompactCurrency, formatPercent } from '@/lib/format';
import { buildDocumentTrustProfile, buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { useHorseRecord, useXbarStore } from '@/store/useXbarStore';

export default function BuyerProfile() {
  const { id } = useParams<{ id: string }>();
  const horse = useHorseRecord(id);
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
  const visibleDocuments = documents
    .map((document) => ({
      document,
      trust: buildDocumentTrustProfile(document, horses),
    }))
    .filter(({ trust }) => trust.readyForProfile);

  return (
    <main className="buyer-shell">
      <div className="buyer-shell__inner">
        <Link className="inline-link" to={`/horses/${horse.id}`}>
          Back to horse workspace
        </Link>

        <div className={`callout${packet.buyerSafe ? '' : ' callout--warning'}`}>
          {packet.buyerProfileNote}
        </div>

        <section className="buyer-hero">
          <div className="buyer-hero__media">
            <img src={horse.profileImage} alt="" className="buyer-hero__image" />
          </div>
          <div className="buyer-hero__copy">
            <div className="eyebrow">Buyer profile</div>
            <h1 className="page-title">{horse.name}</h1>
            <p className="page-description">{horse.summary}</p>
            <div className="status-inline">
              <Pill tone={packet.buyerProfileTone}>{packet.buyerProfileStatus}</Pill>
              <Pill tone={packet.tone}>{formatPercent(packet.score)} packet trust</Pill>
              <Pill tone="blue">{horse.sale.listingState}</Pill>
            </div>
            <div className="buyer-share">
              <span>Share path</span>
              <strong>{packet.sharePath}</strong>
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
            tone="amber"
          />
        </div>

        <div className="detail-grid">
          <Panel eyebrow="Packet trust" title="Buyer-safe coverage">
            <div className="stack-list">
              {packet.requirements.map((requirement) => (
                <div key={requirement.key} className="stack-item">
                  <div className="stack-item__top">
                    <div className="stack-item__title">{requirement.label}</div>
                    <Pill tone={requirement.tone}>{requirement.status}</Pill>
                  </div>
                  <div className="stack-item__copy">{requirement.detail}</div>
                </div>
              ))}
            </div>
            <div className="inline-actions">
              <div className="detail-block subtle">
                Buyer questions still route through the sales desk.
              </div>
            </div>
          </Panel>

          <Panel eyebrow="Horse profile" title="Sale-facing summary">
            <div className="key-grid key-grid--wide">
              <KeyValue label="Registry" value={`${horse.registry} · ${horse.registrationNumber}`} />
              <KeyValue label="Breed / sex" value={`${horse.breed} · ${horse.sex}`} />
              <KeyValue label="Age" value={`${horse.age}`} />
              <KeyValue label="Color" value={horse.color} />
              <KeyValue label="Bloodline" value={`${horse.bloodline.sire} / ${horse.bloodline.dam}`} />
              <KeyValue label="Family" value={horse.bloodline.family} />
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Readiness bar</div>
                <Pill tone={packet.tone}>{formatPercent(packet.score)}</Pill>
              </div>
              <ProgressBar value={packet.score} tone={packet.tone} />
            </div>
          </Panel>
        </div>

        <div className="detail-grid">
          <Panel eyebrow="Verified support" title="Approved packet documents">
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
                <div className="detail-block subtle">
                  No documents clear the buyer threshold yet.
                </div>
              )}
            </div>
          </Panel>

          <Panel eyebrow="Record highlights" title="Profile facts">
            <div className="token-row">
              {horse.ocrFacts.length ? (
                horse.ocrFacts.map((fact) => (
                  <Pill key={fact.id} tone="blue">
                    {fact.label}: {fact.value}
                  </Pill>
                ))
              ) : (
                <Pill tone="slate">No record facts promoted yet</Pill>
              )}
            </div>
          </Panel>
        </div>
      </div>
    </main>
  );
}
