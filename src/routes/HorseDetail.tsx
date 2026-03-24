import { Link, useParams } from 'react-router-dom';
import { KeyValue, PageHeader, Panel, Pill, ProgressBar } from '@/components/app-ui';
import { ChevronLeftIcon } from '@/components/icons';
import { formatCompactCurrency, formatDateLabel, formatPercent } from '@/lib/format';
import { useHorseRecord, useXbarStore } from '@/store/useXbarStore';

export default function HorseDetail() {
  const { id } = useParams<{ id: string }>();
  const horse = useHorseRecord(id);
  const documents = useXbarStore((state) => state.documents.filter((document) => document.horseId === id));
  const ownershipRecord = useXbarStore((state) => state.ownershipRecords.find((record) => record.horseId === id));
  const salesLeads = useXbarStore((state) => state.salesLeads.filter((lead) => lead.horseId === id));

  if (!horse) {
    return (
      <Panel title="Horse not found" description="The requested horse profile is not available in the current mock portfolio.">
        <Link to="/horses" className="button button--ghost">
          Back to Horses
        </Link>
      </Panel>
    );
  }

  return (
    <>
      <Link to="/horses" className="inline-link">
        <ChevronLeftIcon className="inline-link__icon" />
        Back to horses
      </Link>

      <PageHeader
        eyebrow={horse.ownerEntity}
        title={horse.name}
        description={horse.summary}
        actions={
          <>
            <Pill tone={horse.readiness.score >= 85 ? 'emerald' : horse.readiness.score >= 70 ? 'amber' : 'rose'}>
              {horse.status}
            </Pill>
            <Pill tone="blue">{horse.segment}</Pill>
          </>
        }
      />

      <section className="detail-hero">
        <div className="detail-hero__media">
          <img src={horse.profileImage} alt="" className="detail-hero__image" />
          <div className="detail-hero__media-copy">
            <div className="detail-hero__eyebrow">Media foundation</div>
            <h2>Profile hero and gallery architecture are live.</h2>
            <p>Each horse now has room for a hero image, sale stills, pedigree boards, and document-backed presentation assets.</p>
          </div>
        </div>

        <div className="detail-hero__side">
          <Panel title="Sale readiness" description="The profile shows where this horse stands as an asset, not just a record.">
            <div className="stack-list">
              <div className="stack-item">
                <div className="stack-item__top">
                  <div className="stack-item__title">{formatPercent(horse.readiness.score)}</div>
                  <Pill tone="amber">{horse.readiness.packetStatus}</Pill>
                </div>
                <ProgressBar value={horse.readiness.score} tone={horse.readiness.score >= 85 ? 'emerald' : 'amber'} />
                <div className="bullet-list">
                  {horse.readiness.blockers.map((blocker) => (
                    <div key={blocker} className="bullet-list__item">
                      {blocker}
                    </div>
                  ))}
                </div>
              </div>
              <div className="stack-item">
                <div className="inline-metrics">
                  <span>Ask {formatCompactCurrency(horse.sale.askPrice || horse.insuredValue)}</span>
                  <span>{horse.sale.watchlistCount} watchers</span>
                  <span>{horse.sale.inquiryCount} inquiries</span>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </section>

      <div className="detail-grid">
        <Panel eyebrow="Identity" title="Registry and physical profile">
          <div className="key-grid key-grid--wide">
            <KeyValue label="Registry" value={`${horse.registry} · ${horse.aqhaNumber}`} />
            <KeyValue label="Registration" value={horse.registrationNumber} />
            <KeyValue label="Color and markings" value={`${horse.color} · ${horse.markings}`} />
            <KeyValue label="Sex / age" value={`${horse.sex} · ${horse.age}`} />
            <KeyValue label="Foaled" value={formatDateLabel(horse.foaledOn)} />
            <KeyValue label="Microchip" value={horse.microchipId} />
            <KeyValue label="Sire / dam" value={`${horse.bloodline.sire} / ${horse.bloodline.dam}`} />
            <KeyValue label="Family" value={horse.bloodline.family} />
          </div>
        </Panel>

        <Panel eyebrow="Assignments" title="Owner, ranch, and care assignments">
          <div className="key-grid key-grid--wide">
            <KeyValue label="Owner entity" value={horse.ownerEntity} />
            <KeyValue label="Legal owner" value={ownershipRecord?.legalOwner ?? horse.owner} />
            <KeyValue label="Trainer" value={horse.assignments.trainer} />
            <KeyValue label="Veterinarian" value={horse.assignments.veterinarian} />
            <KeyValue label="Ranch manager" value={horse.assignments.ranchManager} />
            <KeyValue label="Farrier" value={horse.assignments.farrier} />
            <KeyValue label="Barn / stall" value={`${horse.location.barn} · ${horse.location.stall}`} />
            <KeyValue label="Pasture" value={horse.location.pasture} />
          </div>
        </Panel>
      </div>

      <div className="detail-grid">
        <Panel eyebrow="Media" title="Gallery and packet assets">
          <div className="media-strip">
            {horse.gallery.map((asset) => (
              <div key={asset.id} className="media-tile">
                <div className="media-tile__image-shell">
                  <img src={asset.url} alt="" className="media-tile__image" />
                </div>
                <div className="media-tile__label">{asset.label}</div>
                <div className="media-tile__meta">
                  <Pill tone={asset.status === 'Approved' ? 'emerald' : asset.status === 'Pending' ? 'amber' : 'slate'}>
                    {asset.status}
                  </Pill>
                  <span>{asset.kind}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="Profile notes" title="Operational summary and packet posture">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__title">Medical note</div>
              <div className="stack-item__copy">{horse.medicalNotes}</div>
            </div>
            <div className="stack-item">
              <div className="stack-item__title">Packet posture</div>
              <div className="inline-metrics">
                <span>{horse.documents.length} linked docs</span>
                <span>{horse.gallery.length} media slots</span>
                <span>{horse.sale.socialReady ? 'Social packet ready' : 'Social packet staged'}</span>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <div className="detail-grid">
        <Panel eyebrow="Ownership" title="Shares, transfer posture, and audit notes">
          <div className="stack-list">
            {horse.ownership.map((stake) => (
              <div key={stake.id} className="stack-item">
                <div className="stack-item__top">
                  <div>
                    <div className="stack-item__title">{stake.name}</div>
                    <div className="stack-item__copy">{stake.contact}</div>
                  </div>
                  <Pill tone="slate">{stake.role}</Pill>
                </div>
                <div className="inline-metrics">
                  <span>{stake.share}% share</span>
                  <span>{ownershipRecord?.transferStatus ?? 'No transfer record'}</span>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="Documents and OCR" title="Packet coverage, extraction, and review">
          <div className="stack-list">
            {documents.map((document) => (
              <div key={document.id} className="stack-item">
                <div className="stack-item__top">
                  <div>
                    <div className="stack-item__title">{document.title}</div>
                    <div className="stack-item__copy">{document.type} · {document.source}</div>
                  </div>
                  <Pill tone={document.state === 'Needs Review' ? 'rose' : document.state === 'Extracting' ? 'amber' : 'emerald'}>
                    {document.state}
                  </Pill>
                </div>
                <div className="stack-item__copy">{document.summary}</div>
                <div className="inline-metrics">
                  <span>Confidence {formatPercent(document.confidence * 100)}</span>
                  <span>{document.duplicateRisk}</span>
                  <span>{document.uploadedAt}</span>
                </div>
              </div>
            ))}
            {!!horse.ocrFacts.length && (
              <div className="token-row">
                {horse.ocrFacts.map((fact) => (
                  <Pill key={fact.id} tone="blue">
                    {fact.label}: {fact.value}
                  </Pill>
                ))}
              </div>
            )}
          </div>
        </Panel>
      </div>

      <div className="detail-grid">
        <Panel eyebrow="Medical" title="Timeline and care notes">
          <div className="timeline">
            {horse.medicalTimeline.map((event) => (
              <div key={event.id} className="timeline__item">
                <div className="timeline__date">{formatDateLabel(event.date)}</div>
                <div>
                  <div className="timeline__title">{event.title}</div>
                  <div className="timeline__copy">{event.summary}</div>
                  <div className="timeline__meta">{event.owner}</div>
                </div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel eyebrow="Breeding and sales" title="Program context and buyer posture">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__title">Listing state</div>
              <div className="inline-metrics">
                <span>{horse.sale.listingState}</span>
                <span>Buyer confidence {formatPercent(horse.sale.buyerConfidence)}</span>
                <span>{horse.sale.socialReady ? 'Social packet ready' : 'Social packet staged'}</span>
              </div>
            </div>
            {horse.breedingTimeline.length ? (
              horse.breedingTimeline.map((event) => (
                <div key={event.id} className="stack-item">
                  <div className="stack-item__title">{event.title}</div>
                  <div className="stack-item__copy">{event.summary}</div>
                </div>
              ))
            ) : (
              <div className="detail-block subtle">No live breeding program on this horse, but the structure is here for mares and studs that need it.</div>
            )}
            {salesLeads.length ? (
              <div className="stack-item">
                <div className="stack-item__title">Active leads</div>
                <div className="bullet-list">
                  {salesLeads.map((lead) => (
                    <div key={lead.id} className="bullet-list__item">
                      {lead.name} · {lead.channel} · {lead.stage}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </Panel>
      </div>

      <Panel eyebrow="Activity" title="Notes, alerts, and audit trail">
        <div className="detail-grid">
          <div className="stack-list">
            {horse.alerts.map((alert) => (
              <div key={alert.id} className="stack-item">
                <div className="stack-item__top">
                  <div className="stack-item__title">{alert.title}</div>
                  <Pill tone={alert.severity === 'high' ? 'rose' : alert.severity === 'medium' ? 'amber' : 'blue'}>
                    {alert.module}
                  </Pill>
                </div>
                <div className="stack-item__copy">{alert.summary}</div>
              </div>
            ))}
          </div>
          <div className="timeline">
            {[...horse.activity, ...horse.notes.map((note) => ({
              id: note.id,
              date: note.createdAt,
              title: note.title,
              summary: note.body,
              owner: note.author,
              category: 'Operations' as const,
            }))].map((entry) => (
              <div key={entry.id} className="timeline__item">
                <div className="timeline__date">{formatDateLabel(entry.date)}</div>
                <div>
                  <div className="timeline__title">{entry.title}</div>
                  <div className="timeline__copy">{entry.summary}</div>
                  <div className="timeline__meta">{entry.owner}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Panel>
    </>
  );
}
