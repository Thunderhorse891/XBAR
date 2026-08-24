import { buildBuyerPacketReleaseGate } from '@/lib/buyerPacketReleaseGate';
import { toPublicPassport } from '@/lib/buyerSafePassport';
import { type SaleCredential, buildSaleCredential } from '@/lib/saleCredential';
import type { LocalPacketAttachment, UnattachedDocument } from '@/lib/localPacketAttachments';
import type { DocumentRecord, HorseRecord, OwnershipRecord, WorkspaceProfile } from '@/types/xbar';

const buyerSafeDocumentTypes = new Set<DocumentRecord['type']>([
  'Registration',
  'Bill of Sale',
  'Vet Record',
  'Coggins',
  'Transfer Packet',
  'Media Kit',
  'Insurance',
  'Ownership Memo',
]);

export type LocalSalePacketDocument = {
  id: string;
  title: string;
  type: DocumentRecord['type'];
  uploadedAt: string;
  summary: string;
  confidence: number;
  buyerSafe: boolean;
};

export type LocalSalePacket = {
  title: string;
  fileName: string;
  html: string;
  plainText: string;
  blockers: string[];
  warnings: string[];
  includedDocuments: LocalSalePacketDocument[];
  /** How many of those documents' files are actually embedded in the packet. */
  attachedFiles: number;
  /** Selected documents whose file could not be embedded, and why. */
  unattachedDocuments: UnattachedDocument[];
  packetScore: number;
  releaseStatus: string;
  credential: SaleCredential;
};

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cleanFileName(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'xbar-sale-packet'
  );
}

/** `1.4 MB` — sized for a human deciding whether to open it on a phone. */
function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function money(value: number) {
  return value ? `$${value.toLocaleString()}` : 'Not listed';
}

function row(label: string, value: unknown) {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value || 'Not provided')}</td></tr>`;
}

function list(items: string[], empty = 'None') {
  if (!items.length) return `<p>${escapeHtml(empty)}</p>`;
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

export function getBuyerSafePacketDocuments(documents: DocumentRecord[], horseId: string): LocalSalePacketDocument[] {
  return documents
    .filter((record) => record.horseId === horseId && record.state === 'Ready')
    .map((record) => ({
      id: record.id,
      title: record.title,
      type: record.type,
      uploadedAt: record.uploadedAt,
      summary: record.summary,
      confidence: record.confidence,
      buyerSafe: buyerSafeDocumentTypes.has(record.type),
    }));
}

export type PacketCredentialParams = {
  horse: HorseRecord;
  documents: DocumentRecord[];
  ownershipRecord?: OwnershipRecord;
  selectedDocumentIds: string[];
  generatedBy: string;
  now?: Date;
};

/**
 * Seal a sale packet from the SAME inputs the packet is rendered from, so the
 * fingerprint and the rendered facts can never drift. Used by both the real
 * generation path (createSalePacketBuild in the store) and the HTML generator
 * below. The credential covers every buyer-facing fact the packet shows —
 * identity, sale terms, ownership/transfer, care & disclosure summary, the
 * release verdict, and the full metadata of each included document — plus the
 * ownership proofs actually verified at seal time (nothing is assumed verified).
 */
export function buildPacketCredential(params: PacketCredentialParams): SaleCredential {
  const now = params.now ?? new Date();
  const releaseGate = buildBuyerPacketReleaseGate({
    horse: params.horse,
    documents: params.documents,
    ownershipRecord: params.ownershipRecord,
  });
  const buyerSafeDocs = getBuyerSafePacketDocuments(params.documents, params.horse.id);
  const selectedDocs = buyerSafeDocs.filter((record) => params.selectedDocumentIds.includes(record.id));
  const passport = toPublicPassport(params.horse);
  const verifiedProofs = (params.ownershipRecord?.proofRequirements ?? [])
    .filter((requirement) => requirement.status === 'verified')
    .map((requirement) => requirement.label);

  return buildSaleCredential({
    passportId: passport.passportId,
    identity: {
      name: params.horse.name,
      barnName: params.horse.barnName ?? '',
      breed: params.horse.breed ?? '',
      sex: params.horse.sex ?? '',
      color: params.horse.color ?? '',
      markings: params.horse.markings ?? '',
      foaledOn: params.horse.foaledOn ?? '',
      age: typeof params.horse.age === 'number' ? params.horse.age : 0,
      registered: Boolean(params.horse.registered),
      registry: params.horse.registry ?? '',
      registrationNumber: params.horse.registrationNumber || params.horse.aqhaNumber || '',
      microchipId: params.horse.microchipId ?? '',
      sire: params.horse.bloodline?.sire ?? '',
      dam: params.horse.bloodline?.dam ?? '',
      owner: params.horse.owner ?? '',
    },
    sale: {
      askPrice: params.horse.sale?.askPrice ?? 0,
      listingState: params.horse.sale?.listingState ?? '',
    },
    ownership: {
      legalOwner: params.ownershipRecord?.legalOwner || params.horse.owner || '',
      ownerEntity: params.horse.ownerEntity ?? '',
      transferStatus: params.ownershipRecord?.transferStatus ?? 'Attention Required',
      pendingDocuments: params.ownershipRecord?.pendingDocuments ?? [],
      complianceDeadline: params.ownershipRecord?.complianceDeadline ?? '',
    },
    care: {
      status: params.horse.status ?? '',
      lastVetVisit: params.horse.lastVetVisit ?? '',
      veterinarian: params.horse.assignments?.veterinarian ?? '',
      farrier: params.horse.assignments?.farrier ?? '',
      medicalNotes: params.horse.medicalNotes ?? '',
    },
    documents: selectedDocs.map((record) => ({
      id: record.id,
      type: record.type,
      title: record.title,
      uploadedAt: record.uploadedAt,
      summary: record.summary ?? '',
      confidence: typeof record.confidence === 'number' ? record.confidence : 0,
    })),
    release: {
      status: releaseGate.status,
      allowed: releaseGate.allowed,
      blockers: releaseGate.blockers,
      warnings: releaseGate.warnings,
    },
    verifiedProofs,
    sealedAt: now.toISOString(),
    sealedBy: params.generatedBy,
  });
}

export function buildLocalSalePacket(params: {
  horse: HorseRecord;
  workspaceProfile: WorkspaceProfile;
  documents: DocumentRecord[];
  ownershipRecord?: OwnershipRecord;
  selectedDocumentIds: string[];
  generatedBy: string;
  /**
   * The buyer-specific watermark, matching what the cloud PDF stamps.
   *
   * Same text, same purpose: a packet that leaks is traceable to the buyer it
   * was prepared for. Defaults to the mark rather than to nothing, because an
   * unwatermarked packet is the one outcome this field exists to prevent.
   */
  watermark?: string;
  /**
   * The selected documents themselves, embedded so the packet is one file the
   * buyer can actually open. Without these the packet lists documents it does
   * not contain.
   */
  attachments?: LocalPacketAttachment[];
  /** Selected documents that could not be embedded, and why. */
  unattached?: UnattachedDocument[];
  now?: Date;
}): LocalSalePacket {
  const now = params.now ?? new Date();
  const generatedAt = now.toISOString().slice(0, 10);
  const releaseGate = buildBuyerPacketReleaseGate({
    horse: params.horse,
    documents: params.documents,
    ownershipRecord: params.ownershipRecord,
  });
  const buyerSafeDocs = getBuyerSafePacketDocuments(params.documents, params.horse.id);
  const selectedDocs = buyerSafeDocs.filter((record) => params.selectedDocumentIds.includes(record.id));

  // Verifiable Sale Credential — sealed from the same inputs this packet renders.
  const credential = buildPacketCredential({
    horse: params.horse,
    documents: params.documents,
    ownershipRecord: params.ownershipRecord,
    selectedDocumentIds: params.selectedDocumentIds,
    generatedBy: params.generatedBy,
    now,
  });

  const attachments = params.attachments ?? [];
  const unattached = params.unattached ?? [];

  const watermark = params.watermark?.trim() || 'XBAR';
  /*
   * The mark has to fit the page AND stay visible, and those pull against each
   * other. A buyer watermark is a name and a date — around fifty characters,
   * not the four in `XBAR` — and at the fixed 78px it ran clean off the right
   * edge and out of the print area, leaving the copy that leaked with no
   * visible mark on it at all, which is the one thing it exists to prevent.
   *
   * Shrinking the type to fit was the obvious fix and the wrong one: at 5%
   * opacity a 20px mark is invisible on paper. So a long mark WRAPS instead —
   * held to a share of the page width, centred, and set large enough to still
   * read through the text. `vw` rather than pixels because a printed page is
   * narrower than the screen the packet was generated on.
   */
  const watermarkSize = watermark.length <= 8 ? '78px' : 'clamp(32px, 5vw, 54px)';

  const title = `XBAR Buyer Sale Packet — ${params.horse.name}`;
  const fileName = `${cleanFileName(params.horse.name)}-xbar-buyer-sale-packet.html`;
  const disclaimer =
    'XBAR LLC(TM) generates this packet from user-supplied records. XBAR does not independently verify horse identity, ownership, registration, liens, veterinary condition, health status, sale terms, or transfer validity. Buyers and sellers must independently verify all information before payment, transport, breeding, insurance, or transfer.';
  const pendingDocuments = params.ownershipRecord?.pendingDocuments.join(', ') || '';

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{margin:0.65in}body{font-family:Arial,sans-serif;margin:0;color:#15202b;background:#fff;line-height:1.5}.packet{position:relative;padding:34px}.watermark{position:fixed;top:44%;left:50%;width:74vw;font-size:${watermarkSize};line-height:1.06;text-align:center;letter-spacing:.18em;color:rgba(17,38,66,.06);transform:translate(-50%,-50%) rotate(-22deg);transform-origin:center;font-weight:800;z-index:0;pointer-events:none}.content{position:relative;z-index:1}header{border-bottom:3px solid #17202a;padding-bottom:18px;margin-bottom:22px}.eyebrow{text-transform:uppercase;letter-spacing:.18em;font-size:11px;color:#315a86;font-weight:700}h1{font-size:28px;margin:8px 0 4px}h2{font-size:15px;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.08em;color:#17202a}.meta{display:flex;gap:12px;flex-wrap:wrap;color:#526273;font-size:12px}.notice{border:1px solid #d7c37a;background:#fff9e6;padding:12px;margin:14px 0}.blocker{border:1px solid #e6a1a1;background:#fff1f1;padding:12px;margin:14px 0}.clear{border:1px solid #9fd7b1;background:#effaf3;padding:12px;margin:14px 0}.seal{border:2px solid #17202a;border-radius:8px;background:#f7fafc;padding:16px;margin:0 0 18px}.seal__code{font-family:'Courier New',monospace;font-size:22px;font-weight:800;letter-spacing:.12em;color:#17202a}.seal__meta{font-size:12px;color:#526273;margin-top:2px}.seal__note{font-size:12px;margin:10px 0}.seal__facts{margin:8px 0 0;font-size:12px}.seal__facts ul{margin:6px 0 0}.seal__facts li{margin-bottom:3px}.seal__digest{font-family:'Courier New',monospace;font-size:10px;color:#64748b;word-break:break-all;margin-top:10px;border-top:1px dashed #cbd5e1;padding-top:8px}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #d8dee6;padding:8px;text-align:left;vertical-align:top;font-size:12px}th{width:30%;background:#f4f7fa}ul{margin-top:8px}li{margin-bottom:4px}.doc-card{border:1px solid #d8dee6;padding:10px;margin:8px 0}.doc-card strong{display:block}.file-list{list-style:none;padding:0;margin:10px 0 0}.file-list li{display:flex;justify-content:space-between;gap:12px;align-items:baseline;border:1px solid #d8dee6;padding:9px 11px;margin-bottom:6px}.file-list a{color:#1d4e7c;font-weight:700;word-break:break-word}.file-size{color:#64748b;font-size:11px;white-space:nowrap}.footer{margin-top:26px;border-top:1px solid #d8dee6;padding-top:10px;font-size:11px;color:#64748b}.signature-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:24px}.signature-line{border-top:1px solid #17202a;padding-top:8px;font-size:12px}@media print{body{background:#fff}.packet{padding:0}}</style></head><body><div class="packet"><div class="watermark">${escapeHtml(watermark)}</div><div class="content"><header><div class="eyebrow">XBAR LLC(TM) Buyer Sale Packet</div><h1>${escapeHtml(params.horse.name)}</h1><div class="meta"><span>Generated ${escapeHtml(generatedAt)}</span><span>Generated by ${escapeHtml(params.generatedBy)}</span><span>Packet score ${releaseGate.score}%</span><span>${escapeHtml(releaseGate.status)}</span></div></header><section class="seal"><div class="seal__code">${escapeHtml(credential.sealCode)}</div><div class="seal__meta">Sealed ${escapeHtml(generatedAt)} · Passport ${escapeHtml(credential.passportId)} · XBAR Verifiable Sale Credential v${credential.version}</div><p class="seal__note">This seal is a SHA-256 fingerprint of every buyer-facing fact in this packet — identity, sale terms, ownership, transfer status, the care &amp; disclosure summary, the release verdict, and the ${selectedDocs.length} included document(s). Compare this seal code with the one the seller gives you directly: if they match, the packet is unaltered since it was sealed on ${generatedAt}. Change any sealed fact and the code no longer matches. The seal proves the packet is unchanged since sealing; it does not independently verify the truth of the underlying records (see the buyer notice below).</p><div class="seal__facts"><strong>Sealed facts</strong><ul>${credential.manifest.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul></div><div class="seal__digest">SHA-256 ${escapeHtml(credential.digest)}</div></section><section class="${releaseGate.allowed ? 'clear' : 'blocker'}"><strong>${escapeHtml(releaseGate.status)}</strong><p>${escapeHtml(releaseGate.summary)}</p><p><strong>Next action:</strong> ${escapeHtml(releaseGate.nextAction)}</p></section><section class="notice"><strong>Buyer verification notice:</strong><p>${escapeHtml(disclaimer)}</p></section><section><h2>Horse identity</h2><table>${[row('Registered name', params.horse.name), row('Barn name', params.horse.barnName), row('Breed', params.horse.breed), row('Sex', params.horse.sex), row('Color', params.horse.color), row('Foaled', params.horse.foaledOn), row('Registry', params.horse.registry), row('Registration number', params.horse.registrationNumber || params.horse.aqhaNumber), row('Microchip', params.horse.microchipId)].join('')}</table></section><section><h2>Sale and buyer posture</h2><table>${[row('Ask price', money(params.horse.sale.askPrice)), row('Listing state', params.horse.sale.listingState), row('Buyer confidence', `${params.horse.sale.buyerConfidence}%`), row('Watchlist count', params.horse.sale.watchlistCount), row('Inquiry count', params.horse.sale.inquiryCount)].join('')}</table></section><section><h2>Ownership and transfer</h2><table>${[row('Legal owner', params.ownershipRecord?.legalOwner || params.horse.owner), row('Owner entity', params.horse.ownerEntity || params.workspaceProfile.defaultOwnerEntity), row('Transfer status', params.ownershipRecord?.transferStatus), row('Pending documents', pendingDocuments), row('Compliance deadline', params.ownershipRecord?.complianceDeadline)].join('')}</table></section><section><h2>Care and disclosure summary</h2><table>${[row('Horse status', params.horse.status), row('Last vet visit', params.horse.lastVetVisit), row('Veterinarian', params.horse.assignments.veterinarian), row('Farrier', params.horse.assignments.farrier), row('Medical notes', params.horse.medicalNotes)].join('')}</table></section><section><h2>Release blockers</h2>${list(releaseGate.blockers, 'No hard blockers flagged by XBAR release gate.')}</section><section><h2>Warnings</h2>${list(releaseGate.warnings, 'No warnings flagged by XBAR release gate.')}</section><section><h2>Included proof documents</h2>${selectedDocs.length ? selectedDocs.map((record) => `<div class="doc-card"><strong>${escapeHtml(record.type)} · ${escapeHtml(record.title)}</strong><span>Uploaded ${escapeHtml(record.uploadedAt)} · Confidence ${record.confidence}%</span><p>${escapeHtml(record.summary || 'No summary provided.')}</p></div>`).join('') : '<p>No proof documents selected for this packet.</p>'}</section><section><h2>Attached files</h2>${attachments.length ? `<p>The ${attachments.length} file${attachments.length === 1 ? ' below is' : 's below are'} included in this packet. Open or save ${attachments.length === 1 ? 'it' : 'them'} straight from this page — there is nothing to sign in to and nothing to install.</p><ul class="file-list">${attachments.map((file) => `<li><a download="${escapeHtml(file.fileName)}" href="${escapeHtml(file.dataUrl)}">${escapeHtml(file.label)}</a> <span class="file-size">${escapeHtml(fileSize(file.sizeBytes))}</span></li>`).join('')}</ul>` : '<p>No files are embedded in this packet.</p>'}${unattached.length ? `<div class="notice"><strong>Not included in this packet:</strong><ul>${unattached.map((item) => `<li>${escapeHtml(item.title)} — ${escapeHtml(item.reason)}</li>`).join('')}</ul><p>Ask the seller to send ${unattached.length === 1 ? 'this file' : 'these files'} separately.</p></div>` : ''}</section><section><h2>Seller review</h2><p>This packet is prepared for buyer review. Seller should confirm all included proof, disclosures, pricing, transfer status, and health records before sending.</p><div class="signature-grid"><div class="signature-line">Seller / authorized representative</div><div class="signature-line">Date</div></div></section><div class="footer">Generated by XBAR LLC(TM). XBAR(TM), XBAR Listings(TM), and related marks are trademarks or service marks claimed by XBAR LLC. This packet is not legal, veterinary, tax, registry, insurance, escrow, or brokerage advice.</div></div></div></body></html>`;

  const displayHtml = html
    .replace('Included proof documents', 'Included documents')
    .replace('No proof documents selected for this packet.', 'No documents selected for this packet.')
    .replace('all included proof, disclosures', 'all included documents, disclosures');

  const plainText = [
    title,
    `Generated ${generatedAt}`,
    `Packet score: ${releaseGate.score}%`,
    `Release status: ${releaseGate.status}`,
    `Blockers: ${releaseGate.blockers.join('; ') || 'None'}`,
    `Included documents: ${selectedDocs.map((record) => record.title).join('; ') || 'None'}`,
    `Attached files: ${attachments.map((file) => file.fileName).join('; ') || 'None'}`,
    // Named here too, not only in the HTML. This is the summary a seller reads
    // back before sending, and what is missing is the part they need to act on.
    `Not attached: ${unattached.map((item) => `${item.title} (${item.reason})`).join('; ') || 'None'}`,
    `Verification seal: ${credential.sealCode}`,
    `SHA-256: ${credential.digest}`,
  ].join('\n');

  return {
    title,
    fileName,
    html: displayHtml,
    plainText,
    blockers: releaseGate.blockers,
    warnings: releaseGate.warnings,
    includedDocuments: selectedDocs,
    attachedFiles: attachments.length,
    unattachedDocuments: unattached,
    packetScore: releaseGate.score,
    releaseStatus: releaseGate.status,
    credential,
  };
}
