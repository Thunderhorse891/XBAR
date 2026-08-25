import { buildBuyerPacketReleaseGate } from '@/lib/buyerPacketReleaseGate';
import { toPublicPassport } from '@/lib/buyerSafePassport';
import { type SaleCredential, buildSaleCredential } from '@/lib/saleCredential';
import { sha256Bytes } from '@/lib/sha256';
import { base64ToBytes } from '@/lib/localFileVault';
import { type PacketDisclosure, toPacketDisclosure } from '@/lib/salePacketDisclosure';
import type { LocalPacketAttachment, UnattachedDocument } from '@/lib/localPacketAttachments';
import type { DocumentRecord, HorseRecord, OwnershipRecord, WorkspaceProfile } from '@/types/xbar';

/**
 * Document types a buyer may see.
 *
 * An allowlist, not a blocklist: a type nobody has classified is withheld
 * rather than sent. `Breeding Contract` is deliberately absent — it is a
 * commercial agreement between the owner and a third party, and the buyer of
 * the horse is not a party to it.
 */
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

export function isBuyerSafeDocumentType(type: DocumentRecord['type']): boolean {
  return buyerSafeDocumentTypes.has(type);
}

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
  return (
    documents
      // The name promised a buyer-safe set and the filter did not deliver one: it
      // returned every Ready document with a `buyerSafe` flag attached, which
      // nothing downstream read. Once the packet embeds the FILES, that is the
      // difference between listing a breeding contract's title and sending its
      // full contents to a stranger.
      .filter(
        (record) => record.horseId === horseId && record.state === 'Ready' && isBuyerSafeDocumentType(record.type),
      )
      .map((record) => ({
        id: record.id,
        title: record.title,
        type: record.type,
        uploadedAt: record.uploadedAt,
        summary: record.summary,
        confidence: record.confidence,
        buyerSafe: buyerSafeDocumentTypes.has(record.type),
      }))
  );
}

export type PacketCredentialParams = {
  horse: HorseRecord;
  documents: DocumentRecord[];
  ownershipRecord?: OwnershipRecord;
  /**
   * The buyer-safe fields this credential seals — REQUIRED, and passed in
   * rather than derived here.
   *
   * `buildLocalSalePacket` renders from the very same object it hands over, so
   * the page and the seal cannot describe different facts. Deriving it twice
   * from the same inputs would look equivalent and quietly stop being so the
   * moment one caller forgot an argument: sealing without `workspaceProfile`
   * covers an empty owner entity while the page prints the workspace default.
   */
  disclosure: PacketDisclosure;
  selectedDocumentIds: string[];
  generatedBy: string;
  /**
   * Files physically embedded in the packet, sealed by their bytes.
   *
   * Omitted by callers that only record a packet — the cloud path and the
   * store's fallback — where there is nothing embedded to fingerprint.
   */
  attachments?: LocalPacketAttachment[];
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

  const disclosure = params.disclosure;

  return buildSaleCredential({
    attachments: (params.attachments ?? []).map((file) => ({
      id: file.id,
      fileName: file.fileName,
      sizeBytes: file.sizeBytes,
      /*
       * The file's own bytes, decoded — not the base64 text that carries them.
       *
       * Both are equally tamper-evident, but only one is CHECKABLE by the buyer
       * this seal exists for. Hashing the base64 meant hand-verification read
       * "extract the substring after the comma in the href attribute and hash
       * that", which nobody does correctly; hashing the decoded bytes means
       * `shasum -a 256 the-file.pdf` on the saved file prints the digest
       * recorded here. A seal a buyer cannot practically recompute is a seal
       * that only ever gets read, and reading it proves nothing.
       */
      digest: sha256Bytes(base64ToBytes(file.dataUrl.slice(file.dataUrl.indexOf(',') + 1))),
    })),
    passportId: passport.passportId,
    // Every field below comes from the buyer-safe disclosure. Sealing straight
    // from the record is how the seller's inquiry counts and a third party's
    // phone number ended up inside a published payload.
    identity: disclosure.identity,
    sale: disclosure.sale,
    ownership: disclosure.ownership,
    care: disclosure.care,
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

/*
 * The packet verifies itself, from its own contents.
 *
 * Before this, the packet printed a seal and told the buyer that comparing it
 * with the seller's copy proved the packet was unaltered. That was false. The
 * seal is text in the file; whoever swapped an embedded Coggins for a clean one
 * could leave the seal untouched, and the buyer's comparison still matched. The
 * packet published a conclusion nobody could check.
 *
 * So the sealed record is published in full, and this recomputes the digest
 * from it AND rehashes every embedded file out of its own data URL, comparing
 * the result against what the record says was sealed. A swapped file now shows
 * as ALTERED.
 *
 * What this script cannot do is authenticate itself: anyone able to edit the
 * attachments can edit this code too. That is why the copy presents the by-hand
 * route as the real one and this button as the convenience, and why both end at
 * the same instruction — compare the RECOMPUTED code with the seal the seller
 * supplied through some other channel. That comparison is the only step an
 * attacker holding the file cannot forge.
 *
 * No escape sequences anywhere below: this source is emitted inside a template
 * literal, so a newline is written as String.fromCharCode(10) rather than being
 * quietly turned into a real line break inside a JavaScript string.
 */
const PACKET_VERIFIER_SCRIPT = `
(function () {
  var btn = document.getElementById('xbar-verify-btn');
  var out = document.getElementById('xbar-verify-out');
  var record = document.getElementById('xbar-credential-payload');
  if (!btn || !out || !record) return;
  var NL = String.fromCharCode(10);
  var sealed = out.getAttribute('data-digest') || '';

  function show(state, text) {
    out.setAttribute('data-state', state);
    out.textContent = text;
  }
  function hex(buffer) {
    var view = new Uint8Array(buffer);
    var text = '';
    for (var i = 0; i < view.length; i += 1) text += ('0' + view[i].toString(16)).slice(-2);
    return text;
  }
  function hash(bytes) {
    return crypto.subtle.digest('SHA-256', bytes).then(hex);
  }
  function bytesOf(base64) {
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  function sealOf(digest) {
    var head = digest.slice(0, 12).toUpperCase();
    return 'SEAL-' + head.slice(0, 4) + '-' + head.slice(4, 8) + '-' + head.slice(8, 12);
  }

  btn.addEventListener('click', function () {
    if (!window.crypto || !crypto.subtle || !window.TextEncoder) {
      show('fail', 'This browser will not recompute hashes for a local file. Use the by-hand steps below instead.');
      return;
    }
    btn.disabled = true;
    show('', 'Recomputing...');

    var problems = [];
    var notes = [];
    var payload = record.textContent || '';

    hash(new TextEncoder().encode(payload))
      .then(function (digest) {
        notes.push('Recomputed SHA-256: ' + digest);
        notes.push('Recomputed seal code: ' + sealOf(digest));
        if (digest !== sealed) problems.push('The sealed record does not match the seal printed on this packet.');

        var parsed = null;
        try {
          parsed = JSON.parse(payload);
        } catch (error) {
          problems.push('The sealed record is not readable, so the files cannot be checked against it.');
        }
        var expected = (parsed && parsed.attachments) || [];
        var links = [].slice.call(document.querySelectorAll('a[data-xbar-file]'));

        return Promise.all(
          links.map(function (link) {
            var href = link.getAttribute('href') || '';
            return hash(bytesOf(href.slice(href.indexOf(',') + 1))).then(function (digest) {
              return {
                id: link.getAttribute('data-xbar-file'),
                fileName: link.getAttribute('download') || '',
                digest: digest,
              };
            });
          }),
        ).then(function (found) {
          found.forEach(function (file) {
            var match = null;
            for (var i = 0; i < expected.length; i += 1) {
              if (expected[i].id === file.id) {
                match = expected[i];
                break;
              }
            }
            if (!match) {
              problems.push('The file "' + file.fileName + '" is not in the sealed record at all.');
              return;
            }
            if (match.digest !== file.digest) {
              problems.push('The file "' + file.fileName + '" is not the one that was sealed.');
            }
            if (match.fileName !== file.fileName) {
              problems.push('The file "' + file.fileName + '" was sealed under the name "' + match.fileName + '".');
            }
          });
          expected.forEach(function (match) {
            for (var i = 0; i < found.length; i += 1) if (found[i].id === match.id) return;
            problems.push('The file "' + match.fileName + '" was sealed but is missing from this packet.');
          });

          notes.push(found.length ? 'Files rehashed from this packet: ' + found.length : 'No embedded files to rehash.');
          btn.disabled = false;

          /*
           * Read the sealed facts back OUT of the record, rather than trusting
           * the ones printed on the page.
           *
           * Everything above the seal is ordinary HTML: an ask price, a
           * transfer status and the 'Sealed facts' list beside them are all
           * editable text, and editing them alone left the digest intact and
           * this check passing. Printing the values the digest actually covers
           * is what makes that edit visible — an attacker cannot change these
           * without changing the record, and changing the record fails the hash
           * two lines up.
           */
          if (parsed) {
            var money = typeof parsed.sale.askPrice === 'number' && parsed.sale.askPrice > 0
              ? '$' + parsed.sale.askPrice.toLocaleString()
              : 'no ask price';
            notes.push('');
            notes.push('The facts this seal covers, read out of the sealed record:');
            notes.push('  Name: ' + (parsed.identity.name || 'unnamed'));
            notes.push('  Registration: ' + (parsed.identity.registered
              ? ((parsed.identity.registry || 'registry') + ' ' + (parsed.identity.registrationNumber || '')).trim()
              : 'not registered'));
            notes.push('  Microchip: ' + (parsed.identity.microchipId || 'none recorded'));
            notes.push('  Ask price: ' + money + ' (' + (parsed.sale.listingState || 'unlisted') + ')');
            notes.push('  Legal owner: ' + (parsed.ownership.legalOwner || 'unknown'));
            notes.push('  Transfer status: ' + (parsed.ownership.transferStatus || 'unknown'));
            notes.push('  Horse status: ' + (parsed.care.status || 'unknown'));
            notes.push('  Last vet visit: ' + (parsed.care.lastVetVisit || 'none recorded'));
            notes.push('  Release verdict: ' + (parsed.release.status || 'unknown'));
            notes.push('  Sealed ' + (parsed.sealedAt || '') + ' by ' + (parsed.sealedBy || 'unknown'));
            notes.push('');
            notes.push('If anything printed on the page above differs from this list, the page was edited and this list is what was sealed.');
          }

          if (problems.length) {
            show('fail', 'ALTERED. This packet does not match its own seal.' + NL + NL + problems.join(NL) + NL + NL + notes.join(NL));
            return;
          }
          show(
            'pass',
            'This packet matches the seal printed on it, and every embedded file is the one that was sealed.' +
              NL + NL + notes.join(NL) + NL + NL +
              'One step left, and it is the one that matters: compare the recomputed seal code above with the code the seller gave you directly. If those differ, the packet was altered and re-sealed.',
          );
        });
      })
      .catch(function (error) {
        btn.disabled = false;
        show('fail', 'Could not finish the check: ' + ((error && error.message) || error) + NL + NL + 'Use the by-hand steps below instead.');
      });
  });
})();
`;

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
  // Built once, then rendered from AND sealed from. Not two derivations that
  // happen to agree — one object, so they cannot disagree.
  const shown = toPacketDisclosure(params.horse, params.ownershipRecord, params.workspaceProfile);

  const credential = buildPacketCredential({
    horse: params.horse,
    documents: params.documents,
    ownershipRecord: params.ownershipRecord,
    disclosure: shown,
    selectedDocumentIds: params.selectedDocumentIds,
    generatedBy: params.generatedBy,
    attachments: params.attachments,
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

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>@page{margin:0.65in}body{font-family:Arial,sans-serif;margin:0;color:#15202b;background:#fff;line-height:1.5}.packet{position:relative;padding:34px}.watermark{position:fixed;top:44%;left:50%;width:74vw;font-size:${watermarkSize};line-height:1.06;text-align:center;letter-spacing:.18em;color:rgba(17,38,66,.06);transform:translate(-50%,-50%) rotate(-22deg);transform-origin:center;font-weight:800;z-index:0;pointer-events:none}.content{position:relative;z-index:1}header{border-bottom:3px solid #17202a;padding-bottom:18px;margin-bottom:22px}.eyebrow{text-transform:uppercase;letter-spacing:.18em;font-size:11px;color:#315a86;font-weight:700}h1{font-size:28px;margin:8px 0 4px}h2{font-size:15px;margin:24px 0 8px;text-transform:uppercase;letter-spacing:.08em;color:#17202a}.meta{display:flex;gap:12px;flex-wrap:wrap;color:#526273;font-size:12px}.notice{border:1px solid #d7c37a;background:#fff9e6;padding:12px;margin:14px 0}.blocker{border:1px solid #e6a1a1;background:#fff1f1;padding:12px;margin:14px 0}.clear{border:1px solid #9fd7b1;background:#effaf3;padding:12px;margin:14px 0}.seal{border:2px solid #17202a;border-radius:8px;background:#f7fafc;padding:16px;margin:0 0 18px}.seal__code{font-family:'Courier New',monospace;font-size:22px;font-weight:800;letter-spacing:.12em;color:#17202a}.seal__meta{font-size:12px;color:#526273;margin-top:2px}.seal__note{font-size:12px;margin:10px 0}.seal__facts{margin:8px 0 0;font-size:12px}.seal__facts ul{margin:6px 0 0}.seal__facts li{margin-bottom:3px}.seal__digest{font-family:'Courier New',monospace;font-size:10px;color:#64748b;word-break:break-all;margin-top:10px;border-top:1px dashed #cbd5e1;padding-top:8px}.verify{margin-top:12px;border-top:1px dashed #cbd5e1;padding-top:10px;font-size:12px}.verify__lead{margin:6px 0}.verify__btn{font:inherit;font-weight:700;padding:7px 13px;border:1px solid #17202a;border-radius:5px;background:#17202a;color:#fff;cursor:pointer}.verify__out{margin-top:8px;padding:9px 11px;border:1px solid #d8dee6;background:#fff;white-space:pre-wrap;word-break:break-word;font-family:'Courier New',monospace;font-size:11px}.verify__out[data-state="pass"]{border-color:#9fd7b1;background:#effaf3}.verify__out[data-state="fail"]{border-color:#e6a1a1;background:#fff1f1}.verify__manual{margin-top:10px}.verify__manual summary{cursor:pointer;font-weight:700}.verify__manual code{background:#eef2f6;padding:1px 4px}.verify__payload{white-space:pre-wrap;word-break:break-all;font-family:'Courier New',monospace;font-size:10px;background:#fff;border:1px solid #d8dee6;padding:9px;max-height:260px;overflow:auto}@media print{.verify__btn{display:none}.verify__manual[open] .verify__payload{max-height:none}}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #d8dee6;padding:8px;text-align:left;vertical-align:top;font-size:12px}th{width:30%;background:#f4f7fa}ul{margin-top:8px}li{margin-bottom:4px}.doc-card{border:1px solid #d8dee6;padding:10px;margin:8px 0}.doc-card strong{display:block}.file-list{list-style:none;padding:0;margin:10px 0 0}.file-list li{display:flex;justify-content:space-between;gap:12px;align-items:baseline;border:1px solid #d8dee6;padding:9px 11px;margin-bottom:6px}.file-list a{color:#1d4e7c;font-weight:700;word-break:break-word}.file-size{color:#64748b;font-size:11px;white-space:nowrap}.disclosure-note{font-size:12px;color:#526273;margin:10px 0 0}.footer{margin-top:26px;border-top:1px solid #d8dee6;padding-top:10px;font-size:11px;color:#64748b}.signature-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:24px}.signature-line{border-top:1px solid #17202a;padding-top:8px;font-size:12px}@media print{body{background:#fff}.packet{padding:0}}</style></head><body><div class="packet"><div class="watermark">${escapeHtml(watermark)}</div><div class="content"><header><div class="eyebrow">XBAR LLC(TM) Buyer Sale Packet</div><h1>${escapeHtml(shown.identity.name)}</h1><div class="meta"><span>Generated ${escapeHtml(generatedAt)}</span><span>Generated by ${escapeHtml(params.generatedBy)}</span><span>Packet score ${releaseGate.score}%</span><span>${escapeHtml(releaseGate.status)}</span></div></header><section class="seal"><div class="seal__code">${escapeHtml(credential.sealCode)}</div><div class="seal__meta">Sealed ${escapeHtml(generatedAt)} · Passport ${escapeHtml(credential.passportId)} · XBAR Verifiable Sale Credential v${credential.version}</div><p class="seal__note">This seal is a SHA-256 fingerprint of every buyer-facing fact in this packet — identity, sale terms, ownership, transfer status, the care &amp; disclosure summary, the release verdict, the ${selectedDocs.length} included document(s), and the bytes of ${attachments.length ? `the ${attachments.length} embedded file(s)` : 'any embedded file'}.</p><p class="seal__note"><strong>Reading the code above proves nothing by itself.</strong> It is printed text inside this file, and anyone who altered the packet could leave it exactly as it is. What proves something is <em>recomputing</em> the fingerprint from what this packet actually contains right now, and comparing the result against the seal code the seller gave you through a channel you trust — a phone call, a separate message, the listing page. Recompute first, then compare. A recomputed code that does not match the one printed above means this packet was changed after it was sealed on ${generatedAt}.</p><p class="seal__note">The seal covers alteration, not truthfulness: it cannot tell you whether the seller's records were accurate when they were sealed (see the buyer notice below).</p><div class="seal__facts"><strong>Sealed facts</strong><ul>${credential.manifest.map((line) => `<li>${escapeHtml(line)}</li>`).join('')}</ul></div><div class="seal__digest">SHA-256 ${escapeHtml(credential.digest)}</div><div class="verify"><strong>Recompute the seal</strong><p class="verify__lead">This rehashes the sealed record and every embedded file out of this page, and prints the facts the seal actually covers &mdash; read out of the record rather than off the page above.</p><p><button class="verify__btn" id="xbar-verify-btn" type="button">Recompute from this packet</button></p><div class="verify__out" data-digest="${escapeHtml(credential.digest)}" id="xbar-verify-out">Not checked yet.</div><details class="verify__manual"><summary>Check it by hand instead &mdash; this does not trust the button above</summary><p>Whoever could alter this packet could alter the script behind that button too. For a packet you have any reason to doubt, do this instead; it needs no software beyond what your computer already has.</p><ol><li>Select the sealed record printed below and save it to a plain text file, with no characters added and no trailing newline.</li><li>Run <code>shasum -a 256 thefile.txt</code> on macOS or Linux, or <code>certutil -hashfile thefile.txt SHA256</code> on Windows.</li><li>That hash must equal the SHA-256 printed above. Its first twelve characters, uppercased, are the seal code: <code>SEAL-XXXX-XXXX-XXXX</code>.</li><li>Compare that seal code with the one the seller gave you directly. Only this comparison &mdash; recomputed against independently supplied &mdash; tells you the packet is unaltered.</li><li>For each embedded file: save it from the list above and hash it the same way. The result must equal that file's <code>digest</code> in the record below.</li></ol><pre class="verify__payload" id="xbar-credential-payload">${escapeHtml(credential.payload)}</pre></details></div></section><section class="${releaseGate.allowed ? 'clear' : 'blocker'}"><strong>${escapeHtml(releaseGate.status)}</strong><p>${escapeHtml(releaseGate.summary)}</p><p><strong>Next action:</strong> ${escapeHtml(releaseGate.nextAction)}</p></section><section class="notice"><strong>Buyer verification notice:</strong><p>${escapeHtml(disclaimer)}</p></section><section><h2>Horse identity</h2><table>${[row('Registered name', shown.identity.name), row('Barn name', shown.identity.barnName), row('Breed', shown.identity.breed), row('Sex', shown.identity.sex), row('Color', shown.identity.color), row('Foaled', shown.identity.foaledOn), row('Registry', shown.identity.registry), row('Registration number', shown.identity.registrationNumber), row('Microchip', shown.identity.microchipId)].join('')}</table></section><section><h2>Sale terms</h2><table>${[row('Ask price', money(shown.sale.askPrice)), row('Listing state', shown.sale.listingState)].join('')}</table></section><section><h2>Ownership and transfer</h2><table>${[row('Legal owner', shown.ownership.legalOwner), row('Owner entity', shown.ownership.ownerEntity), row('Transfer status', shown.ownership.transferStatus), row('Pending documents', pendingDocuments), row('Compliance deadline', shown.ownership.complianceDeadline)].join('')}</table></section><section><h2>Care and disclosure summary</h2><table>${[row('Horse status', shown.care.status), row('Last vet visit', shown.care.lastVetVisit)].join('')}</table><p class="disclosure-note">Health and care disclosure for this horse is the attached vet records and Coggins, listed below. Ask the seller for anything you need that is not here — this summary is a pointer to the documents, not a substitute for reading them.</p></section><section><h2>Release blockers</h2>${list(releaseGate.blockers, 'No hard blockers flagged by XBAR release gate.')}</section><section><h2>Warnings</h2>${list(releaseGate.warnings, 'No warnings flagged by XBAR release gate.')}</section><section><h2>Included proof documents</h2>${selectedDocs.length ? selectedDocs.map((record) => `<div class="doc-card"><strong>${escapeHtml(record.type)} · ${escapeHtml(record.title)}</strong><span>Uploaded ${escapeHtml(record.uploadedAt)} · Confidence ${record.confidence}%</span><p>${escapeHtml(record.summary || 'No summary provided.')}</p></div>`).join('') : '<p>No proof documents selected for this packet.</p>'}</section><section><h2>Attached files</h2>${attachments.length ? `<p>The ${attachments.length} file${attachments.length === 1 ? ' below is' : 's below are'} included in this packet. Open or save ${attachments.length === 1 ? 'it' : 'them'} straight from this page — there is nothing to sign in to and nothing to install.</p><ul class="file-list">${attachments.map((file) => `<li><a data-xbar-file="${escapeHtml(file.id)}" download="${escapeHtml(file.fileName)}" href="${escapeHtml(file.dataUrl)}">${escapeHtml(file.label)}</a> <span class="file-size">${escapeHtml(fileSize(file.sizeBytes))}</span></li>`).join('')}</ul>` : '<p>No files are embedded in this packet.</p>'}${unattached.length ? `<div class="notice"><strong>Not included in this packet:</strong><ul>${unattached.map((item) => `<li>${escapeHtml(item.title)} — ${escapeHtml(item.reason)}</li>`).join('')}</ul><p>Ask the seller to send ${unattached.length === 1 ? 'this file' : 'these files'} separately.</p></div>` : ''}</section><section><h2>Seller review</h2><p>This packet is prepared for buyer review. Seller should confirm all included proof, disclosures, pricing, transfer status, and health records before sending.</p><div class="signature-grid"><div class="signature-line">Seller / authorized representative</div><div class="signature-line">Date</div></div></section><div class="footer">Generated by XBAR LLC(TM). XBAR(TM), XBAR Listings(TM), and related marks are trademarks or service marks claimed by XBAR LLC. This packet is not legal, veterinary, tax, registry, insurance, escrow, or brokerage advice.</div></div></div><script>${PACKET_VERIFIER_SCRIPT}</script></body></html>`;

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
