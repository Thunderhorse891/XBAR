import { useId, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { SalePacketSlots } from '@/components/SalePacketSlots';
import { KeyValue, Panel, Pill, SurfaceTabs } from '@/components/app-ui';
import { ChevronLeftIcon, SharedAccessIcon } from '@/components/icons';
import { getDocumentAccessUrl } from '@/lib/cloudWorkspace';
import { buildPublicShareUrl } from '@/lib/facebookSharing';
import { formatCompactCurrency, formatDateLabel, formatPercent } from '@/lib/format';
import { useUiStore } from '@/store/useUiStore';
import { buildDocumentTrustProfile, buildHorsePacketCompleteness } from '@/lib/xbarPhaseTwo';
import { useCurrentRoleCapability, useHorseRecord, useXbarStore } from '@/store/useXbarStore';
import type { DocumentRecord, DocumentSource, GalleryAsset, SalesLead } from '@/types/xbar';

const mediaKinds: GalleryAsset['kind'][] = ['Hero', 'Conformation', 'Sale Still', 'Pedigree', 'Document Cover'];
const leadChannels: SalesLead['channel'][] = ['Facebook', 'Instagram', 'Referral', 'Site Inquiry'];
const docSources: DocumentSource[] = ['Manual Upload', 'Bulk Intake', 'Shared Upload', 'Sales Packet'];
type DetailTab = 'Overview' | 'Docs' | 'Ops' | 'Activity';
const profileBadgeStyles = [
  'border border-[#0c6f97]/15 bg-[#edf6fa] text-[#0c6f97]',
  'border border-[#708194]/15 bg-[#f1f5f9] text-[#5f6f80]',
  'border border-[#CC3333]/15 bg-[#fff4f4] text-[#CC3333]',
] as const;

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </svg>
  );
}

function PhotoIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m21 15-4.5-4.5L8 19" />
    </svg>
  );
}

function DollarIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M12 3v18" />
      <path d="M16.5 7.2C15.5 6.1 14 5.5 12.4 5.5h-.8C9.3 5.5 7.5 7 7.5 8.9c0 2.2 2 3.1 4.3 3.6l1.4.3c2.4.5 3.8 1.4 3.8 3.4 0 2.1-1.9 3.8-4.6 3.8h-.9c-1.8 0-3.5-.7-4.7-1.9" />
    </svg>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M2.5 12s3.6-6 9.5-6 9.5 6 9.5 6-3.6 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="2.6" />
    </svg>
  );
}

function MessageIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M5 5.5h14a2 2 0 0 1 2 2V16a2 2 0 0 1-2 2H9l-4 3v-3H5a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2Z" />
    </svg>
  );
}

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M10 14 8 16a3 3 0 1 1-4.2-4.2l3-3A3 3 0 0 1 11 8" />
      <path d="m14 10 2-2a3 3 0 1 1 4.2 4.2l-3 3A3 3 0 0 1 13 16" />
      <path d="M8 12h8" />
    </svg>
  );
}

function ReadinessGauge({ value }: { value: number }) {
  const normalized = Math.max(0, Math.min(100, value));
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (normalized / 100) * circumference;
  const gaugeColor = normalized >= 75 ? '#0c6f97' : '#708194';

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
  const currentRole = useXbarStore((state) => state.currentRole);
  const pushToast = useUiStore((state) => state.pushToast);
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
  const [location, setLocation] = useState({
    barn: horse?.location.barn ?? '',
    pasture: horse?.location.pasture ?? '',
    stall: horse?.location.stall ?? '',
  });

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


  const gallerySlots = useMemo(() => Array.from({ length: 4 }, (_, index) => horse.gallery[index] ?? null), [horse.gallery]);
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
      <Link
        to="/horses"
        className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-[#0c6f97] transition-all duration-150 ease-[ease] hover:text-[#095a7a]"
      >
        <ChevronLeftIcon className="h-4 w-4" />
        Back to horses
      </Link>

      <section className="rounded-[10px] border border-[#d8e1ea] bg-[linear-gradient(180deg,#ffffff_0%,#f3f7fb_100%)] px-5 py-5 shadow-sm">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="mb-3 flex items-center gap-3">
              <span className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#8f8378]">{horse.ownerEntity}</span>
              {hasRestrictedActions ? (
                <span
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-[#d8e1ea] bg-[#f4f7fb] text-[#667789] transition-all duration-150 ease-[ease] hover:border-[#0c6f97]/30 hover:text-[#0c6f97]"
                  title={`${currentRole} access limits some profile actions.`}
                >
                  <LockIcon className="h-4 w-4" />
                </span>
              ) : null}
            </div>
            <h1 className="text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.06em] text-[#201d1a]">{horse.name}</h1>
            <div className="mt-4 flex flex-wrap gap-2">
              {[horse.segment, horse.status, horse.location.barn].map((label, index) => (
                <span
                  key={`${label}-${index}`}
                  className={classNames(
                    'inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold tracking-[0.02em]',
                    profileBadgeStyles[index],
                  )}
                >
                  <span
                    className={classNames(
                      'h-2.5 w-2.5 rounded-full',
                      index === 0 ? 'bg-[#0c6f97]' : index === 1 ? 'bg-[#708194]' : 'bg-[#CC3333]',
                    )}
                  />
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <a
              className="inline-flex h-11 items-center justify-center rounded-md bg-[#0c6f97] px-5 text-sm font-semibold text-white shadow-sm transition-all duration-150 ease-[ease] hover:bg-[#095a7a]"
              href={publicShareUrl}
              target="_blank"
              rel="noreferrer"
              onClick={() => void recordSharedChannel(horse.id, 'Direct Link')}
            >
              Open buyer link
            </a>
            <button
              className="inline-flex h-11 items-center justify-center rounded-md border border-[#d8e1ea] bg-white px-5 text-sm font-semibold text-[#445162] transition-all duration-150 ease-[ease] hover:border-[#0c6f97]/30 hover:bg-[#eef3f8] disabled:cursor-not-allowed disabled:opacity-50"
              type="button"
              onClick={() => void handleSavedHorseToggle()}
              disabled={!canManageSharedAccess}
            >
              {saved ? 'Unshare' : 'Share'}
            </button>
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
            <SalePacketSlots slots={packet.saleSlots} />
          </div>

          <div className="mt-5 flex flex-wrap gap-3">
            <StatPill icon={<DollarIcon className="h-4 w-4" />} value={formatCompactCurrency(horse.sale.askPrice || horse.insuredValue)} label="Ask" />
            <StatPill icon={<EyeIcon className="h-4 w-4" />} value={String(horse.sale.watchlistCount)} label="Watchers" />
            <StatPill icon={<MessageIcon className="h-4 w-4" />} value={String(horse.sale.inquiryCount)} label="Inquiries" />
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
                <span>{buyerReadyDocuments.length} buyer-safe</span>
                <span>{packet.shareSlug}</span>
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__title">Buyer view</div>
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
                    <span>Trust {formatPercent(buildDocumentTrustProfile(document, [horse]).trustScore)}</span>
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
              <EmptyState compact title="No documents linked" description="Upload docs to build packet trust." />
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
              {isDocumentUploading ? 'Uploading...' : 'Add intake'}
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
            <EmptyState compact title="No medical timeline" description="Add a care event after the next exam." />
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
                  <div className="stack-item__title">{event.title}</div>
                  <div className="stack-item__copy">{event.summary}</div>
                </div>
              ))
            ) : (
              <EmptyState compact title="No breeding program" description="Add milestones when the horse enters the program." />
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
              <EmptyState compact title="No buyer leads" description="Add a lead to track movement." />
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
                <div className="stack-item__title">Packet trust</div>
                <Pill tone="blue">{packet.buyerProfileStatus}</Pill>
              </div>
              <div className="inline-metrics">
                <span>{packet.readyCount} clear</span>
                <span>{packet.reviewCount} review</span>
                <span>{packet.missingCount} missing</span>
              </div>
            </div>
            <div className="stack-item">
              <div className="stack-item__title">Buyer-safe docs</div>
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
            {horse.alerts.map((alert) => (
              <div key={alert.id} className="stack-item">
                <div className="stack-item__top">
                  <div className="stack-item__title">{alert.title}</div>
                  <Pill tone={alert.severity === 'high' ? 'rose' : alert.severity === 'medium' ? 'blue' : 'slate'}>{alert.module}</Pill>
                </div>
                <div className="stack-item__copy">{alert.summary}</div>
              </div>
            ))}
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



