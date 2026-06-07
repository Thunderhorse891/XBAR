import { useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useConfirm } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { PedigreeChart } from '@/components/PedigreeChart';
import { SalePacketSlots } from '@/components/SalePacketSlots';
import { KeyValue, Panel, Pill, SurfaceTabs } from '@/components/app-ui';
import { ChevronLeftIcon, SharedAccessIcon } from '@/components/icons';
import { getDocumentAccessUrl } from '@/lib/cloudWorkspace';
import { buildPublicShareUrl } from '@/lib/facebookSharing';
import { formatCompactCurrency, formatDateLabel, formatPercent } from '@/lib/format';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { buildDocumentTrustProfile, buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { useCurrentRoleCapability, useHorseRecord, useXbarStore } from '@/store/useXbarStore';
import type { DocumentRecord, DocumentSource, GalleryAsset, HorseSegment, HorseSex, HorseStatus, SalesLead } from '@/types/xbar';
import { classNames, docSources, leadChannels, mediaKinds } from '@/features/horses/constants';
import { medicalEventTypes } from '@/features/health/constants';
import type { DetailTab } from '@/features/horses/types';
import { DollarIcon, LinkIcon, LockIcon, PhotoIcon } from '@/features/horses/icons';

function ReadinessGauge({ value }: { value: number }) {
  const normalized = Math.max(0, Math.min(100, value));
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (normalized / 100) * circumference;
  const gaugeColor = normalized >= 75 ? 'var(--emerald)' : normalized >= 50 ? 'var(--amber)' : 'var(--rose)';

  return (
    <div className="relative mx-auto h-40 w-40">
      <svg viewBox="0 0 120 120" className="h-full w-full -rotate-90">
        <circle cx="60" cy="60" r={radius} stroke="#dce4ec" strokeWidth="8" fill="none" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          stroke={gaugeColor}
          strokeWidth="8"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#6b7785]">Ready</span>
        <span className="mt-1 text-4xl font-bold tracking-[-0.06em] text-[#201d1a]">{normalized}</span>
        <span className="text-sm font-semibold text-[#756a5f]">%</span>
      </div>
    </div>
  );
}


function StatPill({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="flex min-w-[112px] flex-1 items-center gap-3 rounded-md border border-[#d8e1ea] bg-[#f7f9fc] px-3 py-2 shadow-sm transition-all duration-150 ease-[ease] hover:border-[#0c6f97]/30 hover:bg-white">
      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-white text-[#0c6f97] ring-1 ring-[#d8e1ea]">{icon}</span>
      <div className="min-w-0">
        <div className="text-sm font-bold tracking-[-0.03em] text-[#201d1a]">{value}</div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#756a5f]">{label}</div>
      </div>
    </div>
  );
}

export default function HorseDetail() {
  const { id } = useParams<{ id: string }>();
  const horse = useHorseRecord(id);
  const documents = useXbarStore((state) => state.documents.filter((document) => document.horseId === id));
  const ownershipRecord = useXbarStore((state) => state.ownershipRecords.find((record) => record.horseId === id));
  const salesLeads = useXbarStore((state) => state.salesLeads.filter((lead) => lead.horseId === id));
  const sharedListings = useXbarStore((state) => state.sharedListings);
  const toggleSharedListing = useXbarStore((state) => state.toggleSharedListing);
  const recordSharedChannel = useXbarStore((state) => state.recordSharedChannel);
  const uploadHorseMedia = useXbarStore((state) => state.uploadHorseMedia);
  const createDocumentIntake = useXbarStore((state) => state.createDocumentIntake);
  const addHorseNote = useXbarStore((state) => state.addHorseNote);
  const updateHorseLocation = useXbarStore((state) => state.updateHorseLocation);
  const createSalesLead = useXbarStore((state) => state.createSalesLead);
  const updateHorse = useXbarStore((state) => state.updateHorse);
  const deleteHorse = useXbarStore((state) => state.deleteHorse);
  const updateMedicalEvent = useXbarStore((state) => state.updateMedicalEvent);
  const deleteMedicalEvent = useXbarStore((state) => state.deleteMedicalEvent);
  const removeGalleryAsset = useXbarStore((state) => state.removeGalleryAsset);
  const setGalleryAssetStatus = useXbarStore((state) => state.setGalleryAssetStatus);
  const addBreedingEvent = useXbarStore((state) => state.addBreedingEvent);
  const updateBreedingEvent = useXbarStore((state) => state.updateBreedingEvent);
  const deleteBreedingEvent = useXbarStore((state) => state.deleteBreedingEvent);
  const currentRole = useXbarStore((state) => state.currentRole);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const session = useCloudStore((state) => state.session);
  const currentUserName = session?.user?.user_metadata?.full_name || session?.user?.email?.split('@')[0] || workspaceProfile.ranchManagerName || workspaceProfile.defaultOwnerName || 'Ranch Staff';
  const pushToast = useUiStore((state) => state.pushToast);
  const navigate = useNavigate();
  const canManageSharedAccess = useCurrentRoleCapability('manageSharedAccess');
  const canUploadMedia = useCurrentRoleCapability('uploadMedia');
  const canUploadDocuments = useCurrentRoleCapability('uploadDocuments');
  const canEditHorse = useCurrentRoleCapability('editHorse');
  const canManageSales = useCurrentRoleCapability('manageSales');

  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [mediaKind, setMediaKind] = useState<GalleryAsset['kind']>('Hero');
  const [makePrimary, setMakePrimary] = useState(true);
  const [isMediaUploading, setIsMediaUploading] = useState(false);
  const [docFiles, setDocFiles] = useState<File[]>([]);
  const [docSource, setDocSource] = useState<DocumentSource>('Manual Upload');
  const [isDocumentUploading, setIsDocumentUploading] = useState(false);
  const [openingDocumentId, setOpeningDocumentId] = useState('');
  const [noteTitle, setNoteTitle] = useState('Field update');
  const [noteBody, setNoteBody] = useState('');
  const [noteError, setNoteError] = useState('');
  const [leadName, setLeadName] = useState('');
  const [leadChannel, setLeadChannel] = useState<SalesLead['channel']>('Facebook');
  const [leadError, setLeadError] = useState('');
  const [locationError, setLocationError] = useState('');
  const [activeTab, setActiveTab] = useState<DetailTab>('Overview');
  const [editingCore, setEditingCore] = useState(false);
  const [editingMedicalId, setEditingMedicalId] = useState<string | null>(null);
  const [medicalEditForm, setMedicalEditForm] = useState({ title: '', body: '', date: '', type: '' });
  const [editingBreedingId, setEditingBreedingId] = useState<string | null>(null);
  const [breedingEditForm, setBreedingEditForm] = useState({ title: '', body: '', date: '' });
  const [breedingTitle, setBreedingTitle] = useState('');
  const [breedingBody, setBreedingBody] = useState('');
  const [breedingDate, setBreedingDate] = useState('');
  const [breedingError, setBreedingError] = useState('');
  const canManageMedical = useCurrentRoleCapability('manageMedical');
  const canManageBreeding = useCurrentRoleCapability('manageBreeding');
  const [coreForm, setCoreForm] = useState({ name: '', barnName: '', summary: '', breed: '', registry: '', color: '', sex: 'Mare' as HorseSex, aqhaNumber: '', registrationNumber: '', owner: '', ownerEntity: '', askPrice: '', foaledOn: '', microchipId: '', markings: '', bloodlineSire: '', bloodlineDam: '', bloodlineFamily: '', segment: 'Sale Prospect' as HorseSegment, status: 'In Training' as HorseStatus });
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [location, setLocation] = useState({
    barn: horse?.location.barn ?? '',
    pasture: horse?.location.pasture ?? '',
    stall: horse?.location.stall ?? '',
  });
  const [medicalNotesForm, setMedicalNotesForm] = useState({ notes: horse?.medicalNotes ?? '', lastVetVisit: horse?.lastVetVisit ?? '' });
  const [assignmentsForm, setAssignmentsForm] = useState({
    trainer: horse?.assignments.trainer ?? '',
    veterinarian: horse?.assignments.veterinarian ?? '',
    ranchManager: horse?.assignments.ranchManager ?? '',
    farrier: horse?.assignments.farrier ?? '',
  });
  const [assignmentsError, setAssignmentsError] = useState('');

  const mediaInputId = useId();
  const mediaInputRef = useRef<HTMLInputElement | null>(null);

  if (!horse) {
    return (
      <Panel title="Horse not found" description="Record not found in this workspace.">
        <Link to="/horses" className="button button--ghost">
          Back to Horses
        </Link>
      </Panel>
    );
  }

  const activeSharedListing = sharedListings.find((listing) => listing.horseId === horse.id && listing.state !== 'Archived');
  const saved = Boolean(activeSharedListing);
  const packet = buildHorsePacketCompleteness(horse, documents, ownershipRecord);
  const publicShareUrl = buildPublicShareUrl(
    packet.sharePath,
    activeSharedListing?.accessMode === 'Private Token' ? activeSharedListing.shareToken : undefined,
  );
  const buyerReadyDocuments = documents.filter((document) => buildDocumentTrustProfile(document, [horse]).readyForProfile);
  const hasRestrictedActions = !canManageSharedAccess || !canUploadMedia || !canUploadDocuments || !canEditHorse || !canManageSales;


  const gallerySlots = useMemo(() => {
    const slotCount = Math.max(4, horse.gallery.length + (horse.gallery.length < 8 ? 1 : 0));
    return Array.from({ length: slotCount }, (_, index) => horse.gallery[index] ?? null);
  }, [horse.gallery]);
  const salePacketReadyCount = packet.saleSlots.filter((slot) => slot.status === 'ready').length;

  const shareBadgeStyles =
    packet.buyerProfileStatus === 'Live'
      ? 'border border-[#0c6f97]/15 bg-[#edf6fa] text-[#0c6f97]'
      : packet.buyerProfileStatus === 'Blocked'
        ? 'border border-[#CC3333]/15 bg-[#fff4f4] text-[#CC3333]'
        : packet.buyerProfileStatus === 'Needs Review'
          ? 'border border-[#708194]/15 bg-[#f1f5f9] text-[#5f6f80]'
          : 'border border-[#d8e1ea] bg-[#f4f7fb] text-[#667789]';

  const handleSavedHorseToggle = async () => {
    if (!saved && packet.score < 40) {
      const proceed = await confirm(
        'Listing not packet-ready',
        `This horse's sale packet is only ${packet.score}% complete. Buyers may see missing information. Proceed anyway?`,
      );
      if (!proceed) return;
    }
    const result = await toggleSharedListing(horse.id);
    pushToast({
      title: result.ok ? (saved ? 'Removed from shared access' : 'Added to shared access') : 'Shared access blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
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
      label: `${horse.barnName || horse.name} profile upload`,
    });
    pushToast({
      title: result.ok ? 'Document upload updated' : 'Document upload blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok) {
      setDocFiles([]);
    }
    setIsDocumentUploading(false);
  };

  const handleOpenDocument = async (document: Pick<DocumentRecord, 'id' | 'fileUrl' | 'storagePath'>) => {
    const previewWindow = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    if (previewWindow) {
      previewWindow.opener = null;
    }

    setOpeningDocumentId(document.id);
    const access = await getDocumentAccessUrl(document);
    setOpeningDocumentId('');

    if (!access.ok) {
      previewWindow?.close();
      pushToast({
        title: 'File unavailable',
        message: access.message,
        tone: 'error',
      });
      return;
    }

    if (previewWindow) {
      previewWindow.location.href = access.url;
      previewWindow.focus();
      return;
    }

    window.open(access.url, '_blank', 'noopener,noreferrer');
  };

  const handleAddNote = () => {
    if (!noteTitle.trim() || !noteBody.trim()) {
      setNoteError('Enter both a note title and note body.');
      return;
    }

    const result = addHorseNote(horse.id, {
      title: noteTitle,
      body: noteBody,
      author: currentUserName,
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

  const handleAssignmentsUpdate = () => {
    const result = updateHorse(horse.id, { assignments: assignmentsForm });
    pushToast({
      title: result.ok ? 'Assignments saved' : 'Assignments blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok) setAssignmentsError('');
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
      shareReady: saved,
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
      {confirmDialog}
      <Link
        to="/horses"
        className="inline-flex w-fit items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#6888a4] transition-all duration-150 ease-[ease] hover:text-[#98bcd8]"
      >
        <ChevronLeftIcon className="h-3.5 w-3.5" />
        Horses
      </Link>

      {/* Horse Identity Hero — cinematic command file */}
      <section className="relative overflow-hidden rounded-[18px] border border-[rgba(148,184,224,0.1)] bg-[linear-gradient(135deg,#030810_0%,#081626_55%,#091830_100%)] shadow-[0_40px_80px_rgba(0,0,0,0.18),0_12px_32px_rgba(0,0,0,0.10),inset_0_1px_0_rgba(255,255,255,0.04)]">
        {/* Background radials */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_40%,rgba(34,102,238,0.14),transparent_26rem)]" />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(91,141,190,0.08),transparent_20rem)]" />
        </div>

        <div className="relative z-10 flex flex-col gap-5 p-6 xl:flex-row xl:items-end xl:justify-between xl:gap-8">
          <div className="min-w-0 flex-1">
            <div className="mb-3 flex items-center gap-3">
              <span className="text-[10px] font-bold uppercase tracking-[0.26em] text-[rgba(120,170,220,0.65)]">{horse.ownerEntity}</span>
              {hasRestrictedActions ? (
                <span
                  className="inline-flex h-7 w-7 items-center justify-center rounded border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.05)] text-[rgba(180,210,240,0.5)] transition-all duration-150 ease-[ease]"
                  title={`${currentRole} access limits some profile actions.`}
                >
                  <LockIcon className="h-3.5 w-3.5" />
                </span>
              ) : null}
            </div>

            <h1 className="text-[clamp(2.2rem,5vw,3.8rem)] font-extrabold leading-[0.92] tracking-[-0.07em] text-[#f0f7ff]">
              {horse.name}
            </h1>

            <div className="mt-4 flex flex-wrap gap-2">
              {[
                { label: horse.segment, color: 'border-[rgba(12,111,151,0.3)] bg-[rgba(12,111,151,0.12)] text-[#7dcef0]' },
                { label: horse.status, color: 'border-[rgba(112,129,148,0.3)] bg-[rgba(112,129,148,0.1)] text-[#a0b8cc]' },
                horse.location.barn ? { label: horse.location.barn, color: 'border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.05)] text-[rgba(200,220,244,0.75)]' } : null,
              ].filter((x): x is { label: string; color: string } => x !== null).map(({ label, color }, i) => (
                <span
                  key={`${label}-${i}`}
                  className={classNames(
                    'inline-flex items-center rounded-md border px-3 py-1.5 text-[11px] font-semibold tracking-[0.06em]',
                    color,
                  )}
                >
                  {label}
                </span>
              ))}
            </div>

            {/* Packet readiness + quick stats */}
            <div className="mt-5 flex flex-wrap gap-3">
              <div className="flex items-center gap-2 rounded-lg border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.04)] px-3 py-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[rgba(120,160,200,0.6)]">Packet</span>
                <span className={classNames(
                  'text-[13px] font-bold tabular-nums',
                  packet.score >= 75 ? 'text-[#5eead4]' : packet.score >= 50 ? 'text-[#fbbf24]' : 'text-[#ff8a8a]',
                )}>{packet.score}%</span>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.04)] px-3 py-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[rgba(120,160,200,0.6)]">Docs</span>
                <span className="text-[13px] font-bold tabular-nums text-[#e8f2ff]">{documents.length}</span>
              </div>
              <div className="flex items-center gap-2 rounded-lg border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.04)] px-3 py-2">
                <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[rgba(120,160,200,0.6)]">Status</span>
                <span className={classNames(
                  'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-bold',
                  shareBadgeStyles,
                )}>{packet.buyerProfileStatus}</span>
              </div>
              {ownershipRecord ? (
                <div className="flex items-center gap-2 rounded-lg border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.04)] px-3 py-2">
                  <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-[rgba(120,160,200,0.6)]">Ownership</span>
                  <span className={classNames(
                    'text-[13px] font-bold',
                    ownershipRecord.transferStatus === 'Clear' ? 'text-[#5eead4]' : 'text-[#ff8a8a]',
                  )}>{ownershipRecord.transferStatus}</span>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2 xl:flex-col">
            {saved ? (
              <a
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[rgba(80,140,255,0.4)] bg-[rgba(17,85,221,0.78)] px-5 text-sm font-semibold text-white shadow-sm transition-all duration-150 ease-[ease] hover:bg-[rgba(17,85,221,0.95)]"
                href={publicShareUrl}
                target="_blank"
                rel="noreferrer"
                onClick={() => void recordSharedChannel(horse.id, 'Direct Link')}
              >
                <SharedAccessIcon className="h-4 w-4" />
                Open sale listing
              </a>
            ) : (
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-[rgba(80,140,255,0.35)] bg-[rgba(17,85,221,0.7)] px-5 text-sm font-semibold text-white shadow-sm transition-all duration-150 ease-[ease] hover:bg-[rgba(17,85,221,0.9)] disabled:cursor-not-allowed disabled:opacity-40"
                type="button"
                onClick={() => void handleSavedHorseToggle()}
                disabled={!canManageSharedAccess}
              >
                Create listing
              </button>
            )}
            {saved && (
              <button
                className="inline-flex h-10 items-center justify-center rounded-lg border border-[rgba(148,184,224,0.18)] bg-[rgba(255,255,255,0.06)] px-5 text-sm font-semibold text-[rgba(208,228,252,0.88)] transition-all duration-150 ease-[ease] hover:bg-[rgba(255,255,255,0.1)] disabled:cursor-not-allowed disabled:opacity-40"
                type="button"
                onClick={() => void handleSavedHorseToggle()}
                disabled={!canManageSharedAccess}
              >
                Remove listing
              </button>
            )}
            {canEditHorse && (
              <button
                className="inline-flex h-10 items-center justify-center rounded-lg border border-[rgba(255,80,80,0.3)] bg-transparent px-4 text-sm font-semibold text-[rgba(255,140,140,0.8)] transition-all duration-150 ease-[ease] hover:bg-[rgba(255,80,80,0.1)] disabled:cursor-not-allowed disabled:opacity-40"
                type="button"
                onClick={async () => { if (await confirm('Remove horse?', 'Remove this horse from all records? This cannot be undone.')) { const result = deleteHorse(horse.id); if (result.ok) { navigate('/horses'); } else { pushToast({ title: 'Remove failed', message: result.message, tone: 'error' }); } } }}
              >
                Remove horse
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="grid items-stretch gap-5 lg:grid-cols-2">
        <div className="relative flex h-full flex-col overflow-hidden rounded-[10px] border border-[#d8e1ea] bg-[linear-gradient(180deg,#ffffff_0%,#f3f7fb_100%)] p-5 shadow-sm">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[#edf6fa] text-[#0c6f97]">
                <PhotoIcon className="h-5 w-5" />
              </span>
              <div className="text-sm font-semibold tracking-[0.02em] text-[#201d1a]">Media Vault</div>
            </div>
            <button
              type="button"
              onClick={() => mediaInputRef.current?.click()}
              disabled={!canUploadMedia}
              className="inline-flex h-10 items-center justify-center rounded-md border border-[#0c6f97] px-4 text-sm font-semibold text-[#0c6f97] transition-all duration-150 ease-[ease] hover:bg-[#edf6fa] disabled:cursor-not-allowed disabled:opacity-50"
            >
              + Upload
            </button>
          </div>

          <input
            id={mediaInputId}
            ref={mediaInputRef}
            className="hidden"
            type="file"
            multiple
            accept="image/*"
            onChange={(event) => setMediaFiles(Array.from(event.target.files ?? []))}
            disabled={!canUploadMedia}
          />

          <div className="relative grid flex-1 grid-cols-2 gap-3">
            {!horse.gallery.length ? (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <img src={`${import.meta.env.BASE_URL}xbar-logo-sleek.png`} alt="" className="h-28 w-28 opacity-[0.15]" />
              </div>
            ) : null}
            {gallerySlots.map((asset, index) =>
              asset ? (
                <div
                  key={asset.id}
                  className="group relative z-10 aspect-[4/3] overflow-hidden rounded-xl border border-[#d8e1ea] bg-[linear-gradient(145deg,#f7f9fc_0%,#edf2f7_100%)]"
                >
                  <img
                    src={asset.url}
                    alt={asset.label}
                    className="h-full w-full object-cover transition-all duration-150 ease-[ease] group-hover:scale-[1.02]"
                  />
                  <div className="absolute inset-x-0 bottom-0 flex items-end justify-between bg-gradient-to-t from-[#113146]/72 via-[#0c6f97]/18 to-transparent p-3 text-white">
                    <div>
                      <div className="text-xs font-semibold tracking-[0.02em]">{asset.label}</div>
                      <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-white/70">{asset.kind}</div>
                    </div>
                    <span className="rounded-full bg-white/12 px-2.5 py-1 text-[11px] font-semibold backdrop-blur-sm">{asset.status}</span>
                  </div>
                  {canUploadMedia && (
                    <div className="absolute inset-x-0 top-0 flex items-center justify-end gap-1.5 p-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
                      {asset.status !== 'Approved' && (
                        <button
                          type="button"
                          title="Approve photo"
                          className="inline-flex h-7 items-center gap-1 rounded-md bg-[#14532d]/80 px-2.5 text-[11px] font-semibold text-white backdrop-blur-sm hover:bg-[#14532d]"
                          onClick={() => {
                            const result = setGalleryAssetStatus(horse.id, asset.id, 'Approved');
                            pushToast({ title: result.ok ? 'Photo approved' : 'Error', message: result.message, tone: result.ok ? 'success' : 'error' });
                          }}
                        >
                          ✓ Approve
                        </button>
                      )}
                      <button
                        type="button"
                        title="Remove photo"
                        className="inline-flex h-7 items-center gap-1 rounded-md bg-[#7f1d1d]/80 px-2.5 text-[11px] font-semibold text-white backdrop-blur-sm hover:bg-[#7f1d1d]"
                        onClick={async () => {
                          if (!await confirm('Remove photo', `Remove "${asset.label}" from the gallery? This cannot be undone.`)) return;
                          const result = removeGalleryAsset(horse.id, asset.id);
                          pushToast({ title: result.ok ? 'Photo removed' : 'Error', message: result.message, tone: result.ok ? 'success' : 'error' });
                        }}
                      >
                        ✕ Remove
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <label
                  key={`empty-${index}`}
                  htmlFor={mediaInputId}
                  className="relative z-10 flex aspect-[4/3] cursor-pointer items-center justify-center rounded-xl border border-dashed border-[#c8d2dd] bg-[#f7f9fc] text-xs font-semibold uppercase tracking-[0.22em] text-[#708194] transition-all duration-150 ease-[ease] hover:border-[#0c6f97] hover:bg-[#eef3f8]"
                >
                  + Upload
                </label>
              ),
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d8e1ea] bg-[#f7f9fc] px-4 py-3">
            <div className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#6b7785]">
              <span>{horse.gallery.length} assets</span>
              {mediaFiles.length ? <span>{mediaFiles.length} queued</span> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select
                className="h-10 rounded-md border border-[#c8d2dd] bg-white px-3 text-sm font-medium text-[#201d1a] transition-all duration-150 ease-[ease] focus:border-[#0c6f97] focus:outline-none"
                value={mediaKind}
                onChange={(event) => setMediaKind(event.target.value as GalleryAsset['kind'])}
                disabled={!canUploadMedia}
              >
                {mediaKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {kind}
                  </option>
                ))}
              </select>
              <label className="inline-flex h-10 items-center gap-2 rounded-md border border-[#c8d2dd] bg-white px-3 text-sm font-medium text-[#201d1a] transition-all duration-150 ease-[ease] hover:border-[#0c6f97]/40">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-[#c8d2dd] text-[#0c6f97] focus:ring-[#0c6f97]"
                  checked={makePrimary}
                  onChange={(event) => setMakePrimary(event.target.checked)}
                  disabled={!canUploadMedia}
                />
                Hero
              </label>
              <button
                className="inline-flex h-10 items-center justify-center rounded-md bg-[#0c6f97] px-4 text-sm font-semibold text-white shadow-sm transition-all duration-150 ease-[ease] hover:bg-[#095a7a] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => void handleMediaUpload()}
                disabled={!canUploadMedia || isMediaUploading || !mediaFiles.length}
              >
                {isMediaUploading ? 'Saving...' : 'Save media'}
              </button>
            </div>
          </div>
        </div>

        <div className="flex h-full flex-col rounded-[10px] border border-[#d8e1ea] bg-[linear-gradient(180deg,#ffffff_0%,#f3f7fb_100%)] p-5 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-[#edf6fa] text-[#0c6f97]">
              <SharedAccessIcon className="h-5 w-5" />
            </span>
            <div className="text-sm font-semibold tracking-[0.02em] text-[#202225]">Sale Readiness</div>
          </div>

          <ReadinessGauge value={packet.score} />

          <div className="mt-5">
            <div className="mb-3 flex items-center justify-between gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#7a8c9a]">
              <span>Sale packet</span>
              <span>{salePacketReadyCount}/{packet.saleSlots.length} ready</span>
            </div>
            <SalePacketSlots
              slots={packet.saleSlots}
              onFix={(key) => {
                setActiveTab(key === 'aqha-photos' ? 'Overview' : 'Docs');
                if (key !== 'aqha-photos') {
                  setTimeout(() => document.querySelector('.surface-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
                }
              }}
            />
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <StatPill icon={<DollarIcon className="h-4 w-4" />} value={formatCompactCurrency(horse.sale.askPrice || horse.insuredValue)} label="Ask" />
          </div>

          <div className="mt-5">
            <span className={classNames('inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-semibold tracking-[0.02em]', shareBadgeStyles)}>
              <LinkIcon className="h-3.5 w-3.5" />
              {packet.buyerProfileStatus}
            </span>
          </div>
        </div>
      </section>

      <section className="surface-panel">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <SurfaceTabs
            items={['Overview', 'Docs', 'Ops', 'Activity']}
            active={activeTab}
            onChange={(tab) => setActiveTab(tab as DetailTab)}
          />
          <div className="flex flex-wrap gap-2">
            <Pill tone="slate">{documents.length} docs</Pill>
            <Pill tone="blue">{buyerReadyDocuments.length} clear</Pill>
            <Pill tone={packet.buyerProfileTone}>{packet.buyerProfileStatus}</Pill>
          </div>
        </div>
      </section>

      {activeTab === 'Overview' ? (
      <div className="detail-grid">
        <Panel eyebrow="Identity" title="Registry">
          {editingCore ? (
            <div className="form-grid form-grid--tight">
              {(['name', 'barnName', 'breed', 'registry', 'color', 'aqhaNumber', 'registrationNumber', 'owner', 'ownerEntity', 'markings', 'microchipId'] as const).map((field) => (
                <label key={field} className="field-stack">
                  <span className="field-label">{field === 'aqhaNumber' ? 'AQHA #' : field === 'registrationNumber' ? 'Registration #' : field === 'ownerEntity' ? 'Owner entity' : field === 'microchipId' ? 'Microchip ID' : field === 'barnName' ? 'Barn name' : field.charAt(0).toUpperCase() + field.slice(1)}</span>
                  <input className="field-input" value={coreForm[field]} onChange={(e) => setCoreForm((f) => ({ ...f, [field]: e.target.value }))} />
                </label>
              ))}
              <label className="field-stack field-stack--wide">
                <span className="field-label">Profile summary</span>
                <textarea className="field-textarea" rows={3} value={coreForm.summary} onChange={(e) => setCoreForm((f) => ({ ...f, summary: e.target.value }))} />
              </label>
              <label className="field-stack">
                <span className="field-label">Sex</span>
                <select className="field-input" value={coreForm.sex} onChange={(e) => setCoreForm((f) => ({ ...f, sex: e.target.value as HorseSex }))}>
                  {(['Mare', 'Stud', 'Gelding', 'Filly', 'Colt'] as HorseSex[]).map((s) => <option key={s}>{s}</option>)}
                </select>
              </label>
              <label className="field-stack">
                <span className="field-label">Foaled on</span>
                <input className="field-input" type="date" value={coreForm.foaledOn} onChange={(e) => setCoreForm((f) => ({ ...f, foaledOn: e.target.value }))} />
              </label>
              <label className="field-stack">
                <span className="field-label">Segment</span>
                <select className="field-input" value={coreForm.segment} onChange={(e) => setCoreForm((f) => ({ ...f, segment: e.target.value as HorseSegment }))}>
                  {(['Broodmare', 'Stud', 'Show String', 'Sale Prospect', 'Young Stock', 'Retired'] as HorseSegment[]).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="field-stack">
                <span className="field-label">Status</span>
                <select className="field-input" value={coreForm.status} onChange={(e) => setCoreForm((f) => ({ ...f, status: e.target.value as HorseStatus }))}>
                  {(['In Training', 'Broodmare Program', 'Sale Prep', 'Medical Review', 'Pasture', 'Retired'] as HorseStatus[]).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label className="field-stack">
                <span className="field-label">Sire</span>
                <input className="field-input" value={coreForm.bloodlineSire} onChange={(e) => setCoreForm((f) => ({ ...f, bloodlineSire: e.target.value }))} />
              </label>
              <label className="field-stack">
                <span className="field-label">Dam</span>
                <input className="field-input" value={coreForm.bloodlineDam} onChange={(e) => setCoreForm((f) => ({ ...f, bloodlineDam: e.target.value }))} />
              </label>
              <label className="field-stack">
                <span className="field-label">Bloodline family</span>
                <input className="field-input" value={coreForm.bloodlineFamily} onChange={(e) => setCoreForm((f) => ({ ...f, bloodlineFamily: e.target.value }))} />
              </label>
              <label className="field-stack">
                <span className="field-label">Asking price</span>
                <input className="field-input" type="number" min="0" value={coreForm.askPrice} onChange={(e) => setCoreForm((f) => ({ ...f, askPrice: e.target.value }))} placeholder="0" />
              </label>
              <div className="inline-actions inline-actions--span">
                <button className="button button--primary button--compact" type="button" onClick={() => { const result = updateHorse(horse.id, { name: coreForm.name || horse.name, barnName: coreForm.barnName, summary: coreForm.summary, breed: coreForm.breed, registry: coreForm.registry, color: coreForm.color, sex: coreForm.sex, aqhaNumber: coreForm.aqhaNumber, registrationNumber: coreForm.registrationNumber, owner: coreForm.owner, ownerEntity: coreForm.ownerEntity, askPrice: coreForm.askPrice ? Number(coreForm.askPrice) : undefined, foaledOn: coreForm.foaledOn || undefined, microchipId: coreForm.microchipId, markings: coreForm.markings, segment: coreForm.segment, status: coreForm.status, bloodline: { sire: coreForm.bloodlineSire, dam: coreForm.bloodlineDam, family: coreForm.bloodlineFamily } }); if (result.ok) { setEditingCore(false); } else { pushToast({ title: 'Save blocked', message: result.message, tone: 'error' }); } }}>Save</button>
                <button className="button button--ghost button--compact" type="button" onClick={() => setEditingCore(false)}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <div className="key-grid key-grid--wide">
                <KeyValue label="Registry" value={`${horse.registry} · ${horse.aqhaNumber}`} />
                <KeyValue label="Registration" value={horse.registrationNumber} />
                <KeyValue label="Color / marks" value={`${horse.color} · ${horse.markings}`} />
                <KeyValue label="Sex / age" value={`${horse.sex} · ${horse.age}`} />
                <KeyValue label="Foaled" value={formatDateLabel(horse.foaledOn)} />
                <KeyValue label="Microchip" value={horse.microchipId} />
                <KeyValue label="Sire / dam" value={`${horse.bloodline.sire} / ${horse.bloodline.dam}`} />
                <KeyValue label="Family" value={horse.bloodline.family} />
              </div>
              {(horse.bloodline.sire || horse.bloodline.dam) && (
                <div className="inline-actions--mt-xs">
                  <PedigreeChart bloodline={horse.bloodline} horseName={horse.name} />
                </div>
              )}
              <div className="inline-actions inline-actions--mt-xs">
                {canEditHorse && (
                  <button className="button button--ghost button--compact" type="button" onClick={() => { setCoreForm({ name: horse.name, barnName: horse.barnName, summary: horse.summary, breed: horse.breed, registry: horse.registry, color: horse.color, sex: horse.sex, aqhaNumber: horse.aqhaNumber, registrationNumber: horse.registrationNumber, owner: horse.owner, ownerEntity: horse.ownerEntity, askPrice: horse.sale.askPrice ? String(horse.sale.askPrice) : '', foaledOn: horse.foaledOn ?? '', microchipId: horse.microchipId, markings: horse.markings, bloodlineSire: horse.bloodline.sire, bloodlineDam: horse.bloodline.dam, bloodlineFamily: horse.bloodline.family, segment: horse.segment, status: horse.status }); setEditingCore(true); }}>Edit identity</button>
                )}
                {horse.aqhaNumber && (
                  <a
                    className="button button--ghost button--compact"
                    href={`https://www.aqha.com/horse-registration-lookup?q=${encodeURIComponent(horse.aqhaNumber)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`Look up AQHA #${horse.aqhaNumber} on aqha.com`}
                  >
                    Verify on AQHA ↗
                  </a>
                )}
              </div>
            </>
          )}
        </Panel>

        <Panel eyebrow="Assignments" title="Assignments">
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
              disabled={!canEditHorse || (!location.barn.trim() && !location.pasture.trim() && !location.stall.trim())}
            >
              Save location
            </button>
          </div>
          <div className="section-sep">
            <div className="form-grid form-grid--tight">
              <label className="field-stack">
                <span className="field-label">Trainer</span>
                <input className="field-input" value={assignmentsForm.trainer} onChange={(e) => setAssignmentsForm((f) => ({ ...f, trainer: e.target.value }))} disabled={!canEditHorse} />
              </label>
              <label className="field-stack">
                <span className="field-label">Veterinarian</span>
                <input className="field-input" value={assignmentsForm.veterinarian} onChange={(e) => setAssignmentsForm((f) => ({ ...f, veterinarian: e.target.value }))} disabled={!canEditHorse} />
              </label>
              <label className="field-stack">
                <span className="field-label">Ranch manager</span>
                <input className="field-input" value={assignmentsForm.ranchManager} onChange={(e) => setAssignmentsForm((f) => ({ ...f, ranchManager: e.target.value }))} disabled={!canEditHorse} />
              </label>
              <label className="field-stack">
                <span className="field-label">Farrier</span>
                <input className="field-input" value={assignmentsForm.farrier} onChange={(e) => setAssignmentsForm((f) => ({ ...f, farrier: e.target.value }))} disabled={!canEditHorse} />
              </label>
            </div>
            {assignmentsError ? <div className="field-error">{assignmentsError}</div> : null}
            <div className="inline-actions">
              <button
                className="button button--ghost button--compact"
                type="button"
                onClick={handleAssignmentsUpdate}
                disabled={!canEditHorse}
              >
                Save assignments
              </button>
            </div>
          </div>
        </Panel>
      </div>

      ) : null}

      {activeTab === 'Docs' ? (
      <div className="detail-grid">
        <Panel eyebrow="Snapshot" title="Snapshot">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__title">Medical note</div>
              <div className="stack-item__copy">{horse.medicalNotes}</div>
            </div>
            <div className="stack-item">
              <div className="stack-item__title">Packet state</div>
              <div className="inline-metrics">
                <span>{horse.documents.length} docs</span>
                <span>{horse.gallery.length} assets</span>
                <span>{buyerReadyDocuments.length} ready-to-share</span>
                <span>{packet.shareSlug}</span>
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__title">Sale view</div>
              <div className="inline-metrics">
                <span>{packet.buyerProfileStatus}</span>
                <span>{packet.trustSummary}</span>
              </div>
            </div>
          </div>
        </Panel>

        <Panel eyebrow="Documents" title="Documents">
          <div className="stack-list">
            {documents.length ? (
              documents.map((document) => (
                <div key={document.id} className="stack-item">
                  <div className="stack-item__top">
                    <div>
                      <div className="stack-item__title">{document.title}</div>
                      <div className="stack-item__copy">
                        {document.type} · {document.source}
                      </div>
                    </div>
                    <Pill tone={document.state === 'Needs Review' ? 'rose' : 'emerald'}>{document.state}</Pill>
                  </div>
                  <div className="stack-item__copy">{document.summary}</div>
                  <div className="inline-metrics">
                    <span>Confidence {formatPercent(document.confidence * 100)}</span>
                    <span>Complete {formatPercent(buildDocumentTrustProfile(document, [horse]).trustScore)}</span>
                    <span>{document.duplicateRisk}</span>
                    <span>{formatDateLabel(document.uploadedAt)}</span>
                  </div>
                  {document.fileUrl || document.storagePath ? (
                    <div className="inline-actions inline-actions--card">
                      <button
                        className="button button--ghost button--compact"
                        type="button"
                        onClick={() => void handleOpenDocument(document)}
                        disabled={openingDocumentId === document.id}
                      >
                        {openingDocumentId === document.id ? 'Opening...' : 'Open file'}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))
            ) : (
              <EmptyState compact title="No documents linked" description="Upload docs to build the record." />
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
              <span className="field-label">Source</span>
              <select className="field-input" value={docSource} onChange={(event) => setDocSource(event.target.value as DocumentSource)} disabled={!canUploadDocuments}>
                {docSources.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
            </label>
            <label className="field-stack field-stack--wide">
              <span className="field-label">Upload</span>
              <input className="field-input field-input--file" type="file" multiple accept=".pdf,.txt,.csv,image/*" onChange={(event) => setDocFiles(Array.from(event.target.files ?? []))} disabled={!canUploadDocuments} />
            </label>
          </div>
          <div className="inline-actions">
            <button className="button button--ghost button--compact" type="button" onClick={handleDocumentUpload} disabled={!canUploadDocuments || isDocumentUploading || !docFiles.length}>
              {isDocumentUploading ? 'Uploading...' : 'Upload documents'}
            </button>
          </div>
        </Panel>
      </div>
      ) : null}

      {activeTab === 'Ops' ? (
        <>
      <div className="detail-grid">
        <Panel eyebrow="Ownership" title="Ownership">
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

        <Panel eyebrow="Medical" title="Medical">
          {horse.medicalTimeline.length ? (
            <div className="stack-list">
              {horse.medicalTimeline.map((event) => (
                <div key={event.id} className="stack-item">
                  {editingMedicalId === event.id ? (
                    <div className="form-column">
                      <input className="field-input" value={medicalEditForm.title} onChange={(e) => setMedicalEditForm((f) => ({ ...f, title: e.target.value }))} placeholder="Title" />
                      <input className="field-input" value={medicalEditForm.body} onChange={(e) => setMedicalEditForm((f) => ({ ...f, body: e.target.value }))} placeholder="Notes" />
                      <input className="field-input" type="date" value={medicalEditForm.date} onChange={(e) => setMedicalEditForm((f) => ({ ...f, date: e.target.value }))} />
                      <select className="field-select" value={medicalEditForm.type} onChange={(e) => setMedicalEditForm((f) => ({ ...f, type: e.target.value }))}>
                        {medicalEventTypes.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                      <div className="inline-actions">
                        <button className="button button--primary button--compact" type="button" disabled={!medicalEditForm.title.trim()} onClick={() => { const result = updateMedicalEvent(horse.id, event.id, { title: medicalEditForm.title, summary: medicalEditForm.body, date: medicalEditForm.date, status: medicalEditForm.type }); pushToast({ title: result.ok ? 'Event updated' : 'Update failed', message: result.message, tone: result.ok ? 'success' : 'error' }); if (result.ok) setEditingMedicalId(null); }}>Save</button>
                        <button className="button button--ghost button--compact" type="button" onClick={() => setEditingMedicalId(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="stack-item__top">
                        <div>
                          <div className="stack-item__title">{event.title}</div>
                          <div className="stack-item__copy">{event.summary}</div>
                          <div className="timeline__meta">{event.owner}</div>
                        </div>
                        <div className="row-actions">
                          <Pill tone="blue">{formatDateLabel(event.date)}</Pill>
                          {canManageMedical && <button className="button button--ghost button--xs" type="button" onClick={() => { setMedicalEditForm({ title: event.title, body: event.summary, date: event.date, type: event.status ?? '' }); setEditingMedicalId(event.id); }}>Edit</button>}
                          {canManageMedical && <button className="button button--ghost button--xs button--danger-ghost" type="button" onClick={async () => { if (await confirm('Remove event?', 'Remove this medical event? This cannot be undone.')) { const result = deleteMedicalEvent(horse.id, event.id); pushToast({ title: result.ok ? 'Event removed' : 'Remove failed', message: result.message, tone: result.ok ? 'success' : 'error' }); } }}>Delete</button>}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact title="No medical timeline" description="Add a care event after the next exam." />
          )}
          {canEditHorse && (
            <div className="section-sep--sm">
              <div className="form-grid form-grid--tight">
                <label className="field-stack">
                  <span className="field-label">Last vet visit</span>
                  <input className="field-input" type="date" value={medicalNotesForm.lastVetVisit} onChange={(e) => setMedicalNotesForm((f) => ({ ...f, lastVetVisit: e.target.value }))} />
                </label>
                <label className="field-stack field-stack--wide">
                  <span className="field-label">Medical notes</span>
                  <textarea className="field-textarea" rows={3} value={medicalNotesForm.notes} onChange={(e) => setMedicalNotesForm((f) => ({ ...f, notes: e.target.value }))} />
                </label>
              </div>
              <div className="inline-actions">
                <button className="button button--ghost button--compact" type="button" onClick={() => { const result = updateHorse(horse.id, { medicalNotes: medicalNotesForm.notes, lastVetVisit: medicalNotesForm.lastVetVisit || undefined }); pushToast({ title: result.ok ? 'Medical record saved' : 'Medical save blocked', message: result.message, tone: result.ok ? 'success' : 'error' }); }}>
                  Save medical info
                </button>
              </div>
            </div>
          )}
        </Panel>
      </div>

      <div className="detail-grid">
        <Panel eyebrow="Programs" title="Programs">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__title">Listing state</div>
              <div className="inline-metrics">
                <span>{horse.sale.listingState}</span>
                <span>Confidence {formatPercent(horse.sale.buyerConfidence)}</span>
                <span>{horse.sale.socialReady ? 'Social ready' : 'Share pending'}</span>
              </div>
            </div>
            {horse.breedingTimeline.length ? (
              horse.breedingTimeline.map((event) => (
                <div key={event.id} className="stack-item">
                  {editingBreedingId === event.id ? (
                    <div className="form-column">
                      <input className="field-input" value={breedingEditForm.title} onChange={(e) => setBreedingEditForm((f) => ({ ...f, title: e.target.value }))} placeholder="Title" />
                      <input className="field-input" value={breedingEditForm.body} onChange={(e) => setBreedingEditForm((f) => ({ ...f, body: e.target.value }))} placeholder="Notes" />
                      <input className="field-input" type="date" value={breedingEditForm.date} onChange={(e) => setBreedingEditForm((f) => ({ ...f, date: e.target.value }))} />
                      <div className="inline-actions">
                        <button className="button button--primary button--compact" type="button" disabled={!breedingEditForm.title.trim()} onClick={() => { const result = updateBreedingEvent(horse.id, event.id, { title: breedingEditForm.title, summary: breedingEditForm.body, date: breedingEditForm.date }); pushToast({ title: result.ok ? 'Event updated' : 'Update failed', message: result.message, tone: result.ok ? 'success' : 'error' }); if (result.ok) setEditingBreedingId(null); }}>Save</button>
                        <button className="button button--ghost button--compact" type="button" onClick={() => setEditingBreedingId(null)}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="stack-item__top">
                        <div>
                          <div className="stack-item__title">{event.title}</div>
                          <div className="stack-item__copy">{event.summary}</div>
                        </div>
                        <div className="row-actions">
                          <Pill tone="blue">{formatDateLabel(event.date)}</Pill>
                          {canManageBreeding && <button className="button button--ghost button--xs" type="button" onClick={() => { setBreedingEditForm({ title: event.title, body: event.summary, date: event.date }); setEditingBreedingId(event.id); }}>Edit</button>}
                          {canManageBreeding && <button className="button button--ghost button--xs button--danger-ghost" type="button" onClick={async () => { if (await confirm('Remove event?', 'Remove this breeding event? This cannot be undone.')) { const result = deleteBreedingEvent(horse.id, event.id); pushToast({ title: result.ok ? 'Event removed' : 'Remove failed', message: result.message, tone: result.ok ? 'success' : 'error' }); } }}>Delete</button>}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ))
            ) : (
              <EmptyState compact title="No breeding program" description="Add milestones when the horse enters the program." />
            )}
          </div>
          {canManageBreeding && (
            <div className="form-grid form-grid--tight form-grid--mt-sm">
              <label className="field-stack">
                <span className="field-label">Breeding milestone</span>
                <input className="field-input" value={breedingTitle} onChange={(e) => { setBreedingTitle(e.target.value); setBreedingError(''); }} placeholder="e.g. Embryo flush, Foal born" disabled={!canManageBreeding} />
              </label>
              <label className="field-stack">
                <span className="field-label">Date</span>
                <input className="field-input" type="date" value={breedingDate} onChange={(e) => setBreedingDate(e.target.value)} disabled={!canManageBreeding} />
              </label>
              <label className="field-stack field-stack--wide">
                <span className="field-label">Notes</span>
                <input className="field-input" value={breedingBody} onChange={(e) => setBreedingBody(e.target.value)} placeholder="Details" disabled={!canManageBreeding} />
              </label>
            </div>
          )}
          {breedingError ? <div className="field-error">{breedingError}</div> : null}
          {canManageBreeding && (
            <div className="inline-actions inline-actions--mt-sm">
              <button className="button button--primary button--compact" type="button" disabled={!breedingTitle.trim() || !breedingDate.trim()} onClick={() => {
                const result = addBreedingEvent(horse.id, { title: breedingTitle, body: breedingBody, author: workspaceProfile.defaultOwnerName || 'Ranch', date: breedingDate });
                if (result.ok) { setBreedingTitle(''); setBreedingBody(''); setBreedingDate(''); setBreedingError(''); }
                else setBreedingError(result.message);
              }}>Add breeding event</button>
            </div>
          )}
          <div className="stack-list stack-list--mt">
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
              <EmptyState compact title="No sale leads" description="Add a lead to track movement." />
            )}
          </div>
          <div className="form-grid form-grid--tight">
            <label className="field-stack">
              <span className="field-label">Lead name</span>
              <input
                className="field-input"
                value={leadName}
                onChange={(event) => {
                  setLeadName(event.target.value);
                  setLeadError('');
                }}
                disabled={!canManageSales}
              />
            </label>
            <label className="field-stack">
              <span className="field-label">Channel</span>
              <select className="field-input" value={leadChannel} onChange={(event) => setLeadChannel(event.target.value as SalesLead['channel'])} disabled={!canManageSales}>
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
            <button className="button button--primary button--compact" type="button" onClick={handleLeadCreate} disabled={!canManageSales || !leadName.trim()}>
              Add lead
            </button>
          </div>
        </Panel>

        <Panel eyebrow="Files" title="Files">
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Record Complete</div>
                <Pill tone="blue">{packet.buyerProfileStatus}</Pill>
              </div>
              <div className="inline-metrics">
                <span>{packet.readyCount} clear</span>
                <span>{packet.reviewCount} review</span>
                <span>{packet.missingCount} missing</span>
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__title">Ready-to-share docs</div>
              <div className="inline-metrics">
                <span>{buyerReadyDocuments.length} ready</span>
                <span>{documents.length} linked</span>
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__top">
                <div className="stack-item__title">Share path</div>
                <span className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6b7785]">{packet.shareSlug}</span>
              </div>
              <div className="inline-metrics">
                <span>{packet.sharePath}</span>
              </div>
            </div>
          </div>
        </Panel>
      </div>
        </>
      ) : null}

      {activeTab === 'Activity' ? (
      <Panel eyebrow="Activity" title="Activity">
        <div className="detail-grid">
          <div className="stack-list">
            {horse.alerts.length ? horse.alerts.map((alert) => (
              <div key={alert.id} className="stack-item">
                <div className="stack-item__top">
                  <div className="stack-item__title">{alert.title}</div>
                  <Pill tone={alert.severity === 'high' ? 'rose' : alert.severity === 'medium' ? 'blue' : 'slate'}>{alert.module}</Pill>
                </div>
                <div className="stack-item__copy">{alert.summary}</div>
              </div>
            )) : (
              <EmptyState compact title="No active alerts" description="Alerts from medical, ownership, and document modules will appear here." />
            )}
          </div>
          <div className="stack-list">
            <div className="stack-item">
              <div className="stack-item__title">Add note</div>
              <div className="form-grid form-grid--tight">
                <label className="field-stack">
                  <span className="field-label">Title</span>
                  <input
                    className="field-input"
                    value={noteTitle}
                    onChange={(event) => {
                      setNoteTitle(event.target.value);
                      setNoteError('');
                    }}
                    disabled={!canEditHorse}
                  />
                </label>
                <label className="field-stack field-stack--wide">
                  <span className="field-label">Note</span>
                  <textarea
                    className="field-textarea"
                    value={noteBody}
                    onChange={(event) => {
                      setNoteBody(event.target.value);
                      setNoteError('');
                    }}
                    rows={4}
                    disabled={!canEditHorse}
                  />
                </label>
              </div>
              {noteError ? <div className="field-error">{noteError}</div> : null}
              <div className="inline-actions">
                <button className="button button--ghost button--compact" type="button" onClick={handleAddNote} disabled={!canEditHorse || !noteTitle.trim() || !noteBody.trim()}>
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
      ) : null}
    </>
  );
}
