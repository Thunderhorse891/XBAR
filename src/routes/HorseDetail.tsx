import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { KeyValue, PageHeader, Panel, Pill, ProgressBar } from '@/components/app-ui';
import { ChevronLeftIcon } from '@/components/icons';
import { formatCompactCurrency, formatDateLabel, formatPercent } from '@/lib/format';
import { useUiStore } from '@/store/useUiStore';
import { buildDocumentTrustProfile, buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { useHorseRecord, useXbarStore } from '@/store/useXbarStore';
import type { DocumentSource, GalleryAsset, SalesLead } from '@/types/xbar';

const mediaKinds: GalleryAsset['kind'][] = ['Hero', 'Conformation', 'Sale Still', 'Pedigree', 'Document Cover'];
const leadChannels: SalesLead['channel'][] = ['Facebook', 'Instagram', 'Referral', 'Site Inquiry'];
const docSources: DocumentSource[] = ['Manual Upload', 'Bulk Intake', 'Owner Portal', 'Sales Packet'];

export default function HorseDetail() {
  const { id } = useParams<{ id: string }>();
  const horse = useHorseRecord(id);
  const documents = useXbarStore((state) => state.documents.filter((document) => document.horseId === id));
  const ownershipRecord = useXbarStore((state) => state.ownershipRecords.find((record) => record.horseId === id));
  const salesLeads = useXbarStore((state) => state.salesLeads.filter((lead) => lead.horseId === id));
  const savedHorseIds = useXbarStore((state) => state.savedHorseIds);
  const toggleSavedHorse = useXbarStore((state) => state.toggleSavedHorse);
  const uploadHorseMedia = useXbarStore((state) => state.uploadHorseMedia);
  const createDocumentIntake = useXbarStore((state) => state.createDocumentIntake);
  const addHorseNote = useXbarStore((state) => state.addHorseNote);
  const updateHorseLocation = useXbarStore((state) => state.updateHorseLocation);
  const createSalesLead = useXbarStore((state) => state.createSalesLead);
  const pushToast = useUiStore((state) => state.pushToast);

  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [mediaKind, setMediaKind] = useState<GalleryAsset['kind']>('Hero');
  const [makePrimary, setMakePrimary] = useState(true);
  const [isMediaUploading, setIsMediaUploading] = useState(false);
  const [docFiles, setDocFiles] = useState<File[]>([]);
  const [docSource, setDocSource] = useState<DocumentSource>('Manual Upload');
  const [isDocumentUploading, setIsDocumentUploading] = useState(false);
  const [noteTitle, setNoteTitle] = useState('Field update');
  const [noteBody, setNoteBody] = useState('');
  const [noteError, setNoteError] = useState('');
  const [leadName, setLeadName] = useState('');
  const [leadChannel, setLeadChannel] = useState<SalesLead['channel']>('Facebook');
  const [leadError, setLeadError] = useState('');
  const [locationError, setLocationError] = useState('');
  const [location, setLocation] = useState({
    barn: horse?.location.barn ?? '',
    pasture: horse?.location.pasture ?? '',
    stall: horse?.location.stall ?? '',
  });

  if (!horse) {
    return (
      <Panel title="Horse not found" description="Record not found in this workspace.">
        <Link to="/horses" className="button button--ghost">
          Back to Horses
        </Link>
      </Panel>
    );
  }

  const saved = savedHorseIds.includes(horse.id);
  const packet = buildHorsePacketCompleteness(horse, documents, ownershipRecord);
  const buyerReadyDocuments = documents.filter((document) => buildDocumentTrustProfile(document, [horse]).readyForProfile);

  const handleSavedHorseToggle = () => {
    toggleSavedHorse(horse.id);
    pushToast({
      title: saved ? 'Removed from portal' : 'Saved to portal',
      message: `${horse.name} ${saved ? 'was removed from' : 'is now in'} the saved-horse workspace.`,
      tone: 'success',
    });
  };

  const handleMediaUpload = async () => {
    if (!mediaFiles.length) {
      pushToast({ title: 'Media upload blocked', message: 'Select at least one image before uploading.', tone: 'error' });
      return;
    }

    setIsMediaUploading(true);
    const result = await uploadHorseMedia({
      horseId: horse.id,
      files: mediaFiles,
      kind: mediaKind,
      makePrimary,
    });
    pushToast({
      title: result.ok ? 'Media uploaded' : 'Media upload blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok) {
      setMediaFiles([]);
      setMakePrimary(false);
    }
    setIsMediaUploading(false);
  };

  const handleDocumentUpload = async () => {
    if (!docFiles.length) {
      pushToast({ title: 'Document upload blocked', message: 'Select at least one document before uploading.', tone: 'error' });
      return;
    }

    setIsDocumentUploading(true);
    const result = await createDocumentIntake({
      files: docFiles,
      horseId: horse.id,
      source: docSource,
      uploadedBy: 'Horse Profile',
      label: `${horse.barnName} profile intake`,
    });
    pushToast({
      title: result.ok ? 'Document intake updated' : 'Document upload blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok) {
      setDocFiles([]);
    }
    setIsDocumentUploading(false);
  };

  const handleAddNote = () => {
    if (!noteTitle.trim() || !noteBody.trim()) {
      setNoteError('Enter both a note title and note body.');
      return;
    }

    const result = addHorseNote(horse.id, {
      title: noteTitle,
      body: noteBody,
      author: 'Field Ops',
      tone: 'info',
    });
    pushToast({
      title: result.ok ? 'Note saved' : 'Note blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok) {
      setNoteBody('');
      setNoteTitle('Field update');
      setNoteError('');
    }
  };

  const handleLocationUpdate = () => {
    if (!location.barn.trim() && !location.pasture.trim() && !location.stall.trim()) {
      setLocationError('Enter at least one location field before saving.');
      return;
    }

    const result = updateHorseLocation(horse.id, location);
    pushToast({
      title: result.ok ? 'Location saved' : 'Location blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok) {
      setLocationError('');
    }
  };

  const handleLeadCreate = () => {
    if (!leadName.trim()) {
      setLeadError('Lead name is required.');
      return;
    }

    const result = createSalesLead({
      name: leadName,
      channel: leadChannel,
      horseId: horse.id,
      portalReady: saved,
    });
    pushToast({
      title: result.ok ? 'Lead created' : 'Lead blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok) {
      setLeadName('');
      setLeadError('');
    }
  };

  return (
    <>
      <Link to="/horses" className="inline-link">
        <ChevronLeftIcon className="inline-link__icon" />
        Back to horses
      </Link>

      <PageHeader
        eyebrow={horse.ownerEntity}
        title={horse.name}
        description={`${horse.segment} · ${horse.status} · ${horse.location.barn}`}
        actions={
          <>
            <Link className="button button--primary button--compact" to={packet.sharePath}>
              Open buyer profile
            </Link>
            <button className="button button--ghost button--compact" type="button" onClick={handleSavedHorseToggle}>
              {saved ? 'Saved in portal' : 'Save to portal'}
            </button>
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
            <div className="detail-hero__eyebrow">Media vault</div>
            <h2>Gallery and packet assets.</h2>
            <p>Upload sale stills, hero images, and packet covers.</p>
          </div>
        </div>

        <div className="detail-hero__side">
          <Panel title="Sale readiness" description="Live packet status.">
            <div className="stack-list">
              <div className="stack-item">
                <div className="stack-item__top">
                  <div className="stack-item__title">{formatPercent(packet.score)}</div>
                  <div className="status-inline">
                    <Pill tone={packet.buyerProfileTone}>{packet.buyerProfileStatus}</Pill>
                    <Pill tone={packet.tone}>{horse.readiness.packetStatus}</Pill>
                  </div>
                </div>
                <ProgressBar value={packet.score} tone={packet.tone} />
                <div className="bullet-list">
                  {packet.requirements.map((requirement) => (
                    <div key={requirement.key} className="bullet-list__item">
                      {requirement.label}: {requirement.detail}
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
                <div className="detail-block subtle">{packet.buyerProfileNote}</div>
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
          <div className="form-grid form-grid--tight">
            <label className="field-stack">
              <span className="field-label">Barn</span>
              <input className="field-input" value={location.barn} onChange={(event) => setLocation((current) => ({ ...current, barn: event.target.value }))} />
            </label>
            <label className="field-stack">
              <span className="field-label">Pasture</span>
              <input className="field-input" value={location.pasture} onChange={(event) => setLocation((current) => ({ ...current, pasture: event.target.value }))} />
            </label>
            <label className="field-stack">
              <span className="field-label">Stall</span>
              <input className="field-input" value={location.stall} onChange={(event) => setLocation((current) => ({ ...current, stall: event.target.value }))} />
            </label>
          </div>
          {locationError ? <div className="field-error">{locationError}</div> : null}
          <div className="inline-actions">
            <button
              className="button button--ghost button--compact"
              type="button"
              onClick={handleLocationUpdate}
              disabled={!location.barn.trim() && !location.pasture.trim() && !location.stall.trim()}
            >
              Save location
            </button>
          </div>
        </Panel>
      </div>

      <div className="detail-grid">
        <Panel eyebrow="Media" title="Gallery and packet assets" description="Images and packet files.">
          {horse.gallery.length ? (
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
          ) : (
            <EmptyState compact title="No media uploaded" description="Upload hero images, conformation shots, or sale stills for this horse." />
          )}
          <div className="form-grid form-grid--tight">
            <label className="field-stack">
              <span className="field-label">Media kind</span>
              <select className="field-input" value={mediaKind} onChange={(event) => setMediaKind(event.target.value as GalleryAsset['kind'])}>
                {mediaKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack">
              <span className="field-label">Upload images</span>
              <input className="field-input field-input--file" type="file" multiple accept="image/*" onChange={(event) => setMediaFiles(Array.from(event.target.files ?? []))} />
            </label>
            <label className="field-stack field-stack--checkbox">
              <input type="checkbox" checked={makePrimary} onChange={(event) => setMakePrimary(event.target.checked)} />
              <span>Use first upload as hero image</span>
            </label>
          </div>
          <div className="inline-actions">
            <button className="button button--primary button--compact" type="button" onClick={handleMediaUpload} disabled={isMediaUploading || !mediaFiles.length}>
              {isMediaUploading ? 'Uploading media...' : 'Upload media'}
            </button>
          </div>
        </Panel>

        <Panel eyebrow="Profile notes" title="Operational summary">
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
                <span>{buyerReadyDocuments.length} buyer-safe docs</span>
                <span>{packet.shareSlug}</span>
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__title">Buyer profile</div>
              <div className="inline-metrics">
                <span>{packet.buyerProfileStatus}</span>
                <span>{packet.trustSummary}</span>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <div className="detail-grid">
        <Panel eyebrow="Ownership" title="Shares and transfer posture">
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

        <Panel eyebrow="Documents" title="Packet coverage">
          <div className="stack-list">
            {documents.length ? (
              documents.map((document) => (
                <div key={document.id} className="stack-item">
                  <div className="stack-item__top">
                    <div>
                      <div className="stack-item__title">{document.title}</div>
                      <div className="stack-item__copy">{document.type} · {document.source}</div>
                    </div>
                      <Pill tone={document.state === 'Needs Review' ? 'rose' : 'emerald'}>
                        {document.state}
                      </Pill>
                  </div>
                  <div className="stack-item__copy">{document.summary}</div>
                  <div className="inline-metrics">
                    <span>Confidence {formatPercent(document.confidence * 100)}</span>
                    <span>Trust {formatPercent(buildDocumentTrustProfile(document, [horse]).trustScore)}</span>
                    <span>{document.duplicateRisk}</span>
                    <span>{formatDateLabel(document.uploadedAt)}</span>
                  </div>
                </div>
              ))
            ) : (
              <EmptyState compact title="No documents linked" description="Upload documents to build packet trust for this horse." />
            )}
            {!!horse.documentFacts.length && (
              <div className="token-row">
                {horse.documentFacts.map((fact) => (
                  <Pill key={fact.id} tone="blue">
                    {fact.label}: {fact.value}
                  </Pill>
                ))}
              </div>
            )}
          </div>
          <div className="form-grid form-grid--tight">
            <label className="field-stack">
              <span className="field-label">Document source</span>
              <select className="field-input" value={docSource} onChange={(event) => setDocSource(event.target.value as DocumentSource)}>
                {docSources.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack field-stack--wide">
              <span className="field-label">Upload documents</span>
              <input className="field-input field-input--file" type="file" multiple accept=".pdf,.txt,.csv,image/*" onChange={(event) => setDocFiles(Array.from(event.target.files ?? []))} />
            </label>
          </div>
          <div className="inline-actions">
            <button className="button button--ghost button--compact" type="button" onClick={handleDocumentUpload} disabled={isDocumentUploading || !docFiles.length}>
              {isDocumentUploading ? 'Uploading documents...' : 'Add to document intake'}
            </button>
          </div>
        </Panel>
      </div>

      <div className="detail-grid">
        <Panel eyebrow="Medical" title="Timeline and care notes">
          {horse.medicalTimeline.length ? (
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
          ) : (
            <EmptyState compact title="No medical timeline yet" description="Add medical events from the Medical module or after a new exam." />
          )}
        </Panel>

        <Panel eyebrow="Breeding and sales" title="Program and buyer posture">
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
              <EmptyState compact title="No breeding program yet" description="Add breeding milestones from the Breeding module when this horse enters the program." />
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
            ) : (
              <EmptyState compact title="No active buyer leads" description="Add a lead below to start tracking contact and offer movement." />
            )}
          </div>
          <div className="form-grid form-grid--tight">
            <label className="field-stack">
              <span className="field-label">Lead name</span>
              <input className="field-input" value={leadName} onChange={(event) => {
                setLeadName(event.target.value);
                setLeadError('');
              }} />
            </label>
            <label className="field-stack">
              <span className="field-label">Lead channel</span>
              <select className="field-input" value={leadChannel} onChange={(event) => setLeadChannel(event.target.value as SalesLead['channel'])}>
                {leadChannels.map((channel) => (
                  <option key={channel} value={channel}>
                    {channel}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {leadError ? <div className="field-error">{leadError}</div> : null}
          <div className="inline-actions">
            <button className="button button--primary button--compact" type="button" onClick={handleLeadCreate} disabled={!leadName.trim()}>
              Add buyer lead
            </button>
          </div>
        </Panel>
      </div>

      <Panel eyebrow="Activity" title="Notes and alerts">
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
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__title">Add field note</div>
              <div className="form-grid form-grid--tight">
                <label className="field-stack">
                  <span className="field-label">Note title</span>
                  <input className="field-input" value={noteTitle} onChange={(event) => {
                    setNoteTitle(event.target.value);
                    setNoteError('');
                  }} />
                </label>
                <label className="field-stack field-stack--wide">
                  <span className="field-label">Note</span>
                  <textarea className="field-textarea" value={noteBody} onChange={(event) => {
                    setNoteBody(event.target.value);
                    setNoteError('');
                  }} rows={4} />
                </label>
              </div>
              {noteError ? <div className="field-error">{noteError}</div> : null}
              <div className="inline-actions">
                <button className="button button--ghost button--compact" type="button" onClick={handleAddNote} disabled={!noteTitle.trim() || !noteBody.trim()}>
                  Save note
                </button>
              </div>
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
        </div>
      </Panel>
    </>
  );
}
