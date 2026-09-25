// Verifiable Sale Credential — a tamper-evident fingerprint for a sale packet.
//
// The problem it solves: today a buyer looking at an XBAR sale packet has to
// *take the seller's word* that the identity, ownership, transfer status, care
// disclosures, and proof documents are what they say — and that nothing was
// quietly changed after the packet was generated. This credential makes any such
// change detectable.
//
// How it works, honestly:
//   1. We collect EVERY buyer-facing fact the packet renders — identity, sale
//      terms, ownership/transfer, the care & disclosure summary, the release
//      verdict, and the full metadata of each included document — plus which
//      ownership proofs were VERIFIED at seal time.
//   2. We serialize them canonically (keys sorted, arrays ordered) so the same
//      facts always produce the same bytes, regardless of insertion order.
//   3. We SHA-256 those bytes into a single digest, published as the seal.
//
// What the seal proves: every covered fact is bound into one fingerprint. Change
// ANY of them — a swapped document, an edited transfer status, a bumped ask
// price, a downgraded proof — and the recomputed digest no longer matches the
// published seal. `verifySaleCredential` reports the mismatch. That is genuine
// tamper-EVIDENCE: alterations cannot hide.
//
// What it does NOT claim on its own: `verifySaleCredential` proves a payload
// matches a GIVEN digest. It does not authenticate where that digest came from.
// For the guarantee to hold against a seller who re-seals forged facts, the
// buyer must obtain the seal from a trusted channel — the seal code the seller
// communicates directly, or (the immediate follow-on) XBAR's server-anchored
// record of the seal. Until that anchor ships, the honest claim is: this detects
// accidental or third-party alteration and lets a holder confirm a packet is
// unchanged against a seal code they trust. UI copy states exactly this and
// never implies the bundle self-authenticates.

import { sha256 } from './sha256.js';

/*
 * v3, two changes from v2:
 *
 *  - Attachment digests cover the file's decoded BYTES rather than the base64
 *    text that carried them. Same tamper-evidence either way, but only the
 *    bytes are what `shasum -a 256` prints for a file saved out of the packet,
 *    and a seal nobody can practically recompute is a seal that only gets read.
 *  - `care` no longer carries `veterinarian`, `farrier` or `medicalNotes`. The
 *    payload is published inside the packet so the digest can be recomputed,
 *    which makes everything sealed also everything disclosed — so the sealed
 *    set had to narrow to what a buyer may actually see.
 *
 * Both land under one version because no v3 packet exists outside this branch;
 * two different payload shapes must never share a version number.
 */
/*
 * 4: the buyer watermark joined the sealed payload.
 *
 * Bumped rather than added quietly. The payload's shape is what a buyer hashes
 * by hand, and a reader comparing two packets sealed weeks apart should be able
 * to tell from the version alone that the covered facts differ.
 */
/*
 * 5, two changes from 4:
 *
 *  - `release` (the seller-side release verdict: status, blockers, warnings)
 *    left the payload. The payload is printed inside the buyer packet for
 *    hand-verification, which makes everything sealed also everything
 *    disclosed — and the verdict was stripped from the buyer artifact
 *    deliberately. The release gate still drives the seller-side wizard; it
 *    is just no longer part of what the buyer hashes.
 *  - `seller` joined the payload: the seller name, ranch, operations email,
 *    and hero photo the packet renders. They were printed in the packet but
 *    outside the seal, so altering the visible contact block or swapping the
 *    photo left the digest untouched. The photo is sealed by content digest
 *    when its bytes were available at seal time (data: URL), otherwise by URL.
 */
export const SALE_CREDENTIAL_VERSION = 5 as const;

/** Every buyer-facing metadata field of one included document. File bytes are
 * generated server-side; these fields are what the packet renders, so covering
 * them means a later edit to a title, summary, or confidence breaks the seal. */
export interface CredentialDocument {
  id: string;
  type: string;
  title: string;
  uploadedAt: string;
  summary: string;
  confidence: number;
}

/** Buyer-facing identity block the packet renders. */
export interface CredentialIdentity {
  name: string;
  barnName: string;
  breed: string;
  sex: string;
  color: string;
  markings: string;
  foaledOn: string;
  age: number;
  registered: boolean;
  registry: string;
  registrationNumber: string;
  microchipId: string;
  sire: string;
  dam: string;
}

/** Buyer-facing sale terms the packet renders. */
export interface CredentialSale {
  askPrice: number;
  listingState: string;
}

/** Buyer-facing ownership & transfer facts the packet renders. */
export interface CredentialOwnership {
  legalOwner: string;
  ownerEntity: string;
  transferStatus: string;
  pendingDocuments: string[];
  complianceDeadline: string;
}

/** Buyer-facing care & disclosure summary the packet renders. */
/**
 * Care facts the seal covers — and therefore the care facts the packet shows.
 *
 * `veterinarian`, `farrier` and `medicalNotes` were here and are deliberately
 * gone. The first two are third parties' contact details; the third is
 * unreviewed internal free text. None of them belong in a document emailed to a
 * prospective buyer, and leaving them in the payload would publish them twice
 * over now that the payload is printed inside the packet for verification.
 *
 * Health disclosure did not go away with them: it comes from the vet records
 * and Coggins the seller deliberately attached, which the buyer can read in
 * full rather than through someone's shorthand.
 */
export interface CredentialCare {
  status: string;
  lastVetVisit: string;
}

/** Seller contact block the packet renders, sealed so the visible seller name,
 * ranch and email cannot be swapped without breaking the digest. The hero
 * photo is sealed by URL — or by content digest when the bytes were in hand
 * at seal time (see heroPhotoDigest): a remote photo's bytes can change at
 * that address without breaking the seal, and the packet says so.
 *
 * Everything here is buyer-facing by design: it is exactly what the packet's
 * "Contact the seller" section shows. Sealing it closes the hole where the
 * packet printed contact details the fingerprint did not cover.
 */
export interface CredentialSeller {
  name: string;
  ranch: string;
  email: string;
  heroPhotoUrl: string;
  /**
   * SHA-256 of the hero photo's bytes when they were available at seal time
   * (data: URL). Empty for remote URLs: the URL itself is sealed, which
   * detects photo-swapping, while byte-level integrity of a remote file is a
   * storage concern the seal cannot observe.
   */
  heroPhotoDigest: string;
}

/**
 * One file physically embedded in the packet.
 *
 * Sealed by the digest of its BYTES, not by its name or size. Once a packet
 * carries the documents themselves rather than a list of their titles, a seal
 * over the titles proves nothing about what a buyer actually opens: swap the
 * base64 behind `Coggins 2026` and every sealed fact still matches. The packet
 * tells its reader that a matching seal means it is unaltered, so that has to
 * be true of the files too.
 */
export interface CredentialAttachment {
  /** The document record's id, so the file lines up with its metadata entry. */
  id: string;
  fileName: string;
  sizeBytes: number;
  /** SHA-256 of the file's bytes. */
  digest: string;
}

export interface SaleCredentialInput {
  /** Stable public identifier for the animal (never the internal record id). */
  passportId: string;
  identity: CredentialIdentity;
  sale: CredentialSale;
  ownership: CredentialOwnership;
  care: CredentialCare;
  documents: CredentialDocument[];
  /** Files embedded in the packet. Empty when the packet only lists documents. */
  attachments: CredentialAttachment[];
  /**
   * The seller contact block the packet renders — sealed, because it is
   * buyer-visible and was previously printed outside the fingerprint.
   */
  seller: CredentialSeller;
  /** Human labels of the ownership proofs that were VERIFIED at seal time. */
  verifiedProofs: string[];
  /**
   * The buyer-specific watermark stamped across the packet — REQUIRED.
   *
   * This is the packet's only means of tracing a leaked copy back to the buyer
   * it was issued to, and it was outside the seal: a recipient could edit the
   * watermark out of the HTML, or swap in someone else's name, and the verifier
   * still reported a matching seal. Sealing it makes the attribution as
   * tamper-evident as the facts beside it.
   *
   * Required rather than optional so a caller cannot silently seal a packet
   * with no attribution — which is the one outcome the field exists to prevent.
   * Callers pass the RESOLVED value (`resolvePacketWatermark`), never the raw
   * input, so the seal and the printed page cannot describe different buyers.
   */
  watermark: string;
  sealedAt: string; // ISO
  sealedBy: string;
}

export interface SaleCredential {
  version: typeof SALE_CREDENTIAL_VERSION;
  passportId: string;
  /** Full 64-char SHA-256 hex digest of the canonical payload. */
  digest: string;
  /** Short, human-readable seal derived from the digest, e.g. "SEAL-BA78-16BF-8F01". */
  sealCode: string;
  sealedAt: string;
  sealedBy: string;
  /** Plain-language list of what the seal covers, for display next to it. */
  manifest: string[];
  /** The exact canonical string that was hashed. Republished so a holder can
   * recompute the digest and confirm it matches. */
  payload: string;
}

// --- Canonicalization -------------------------------------------------------

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Deterministic JSON: object keys sorted, arrays kept in caller-defined order.
 * The same logical facts always serialize to the same string. */
function canonicalStringify(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
}

/** Build the canonical, order-stable object the digest is computed over. Arrays
 * with no inherent order (documents, proofs, blockers, warnings, pending docs)
 * are sorted here so reordering the same facts never changes the seal. */
export function buildCredentialPayload(input: SaleCredentialInput): string {
  const documents = [...input.documents]
    .map((doc) => ({
      id: doc.id,
      type: doc.type,
      title: doc.title,
      uploadedAt: doc.uploadedAt,
      summary: doc.summary,
      confidence: doc.confidence,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // Sorted by id like the documents above, so the same set of files always
  // serializes identically regardless of the order they were read in.
  const attachments = [...input.attachments]
    .map((file) => ({
      id: file.id,
      fileName: file.fileName,
      sizeBytes: file.sizeBytes,
      digest: file.digest,
    }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const payload: Json = {
    version: SALE_CREDENTIAL_VERSION,
    passportId: input.passportId,
    watermark: input.watermark,
    identity: {
      name: input.identity.name,
      barnName: input.identity.barnName,
      breed: input.identity.breed,
      sex: input.identity.sex,
      color: input.identity.color,
      markings: input.identity.markings,
      foaledOn: input.identity.foaledOn,
      age: input.identity.age,
      registered: input.identity.registered,
      registry: input.identity.registry,
      registrationNumber: input.identity.registrationNumber,
      microchipId: input.identity.microchipId,
      sire: input.identity.sire,
      dam: input.identity.dam,
    },
    sale: {
      askPrice: input.sale.askPrice,
      listingState: input.sale.listingState,
    },
    ownership: {
      legalOwner: input.ownership.legalOwner,
      ownerEntity: input.ownership.ownerEntity,
      transferStatus: input.ownership.transferStatus,
      pendingDocuments: [...input.ownership.pendingDocuments].sort(),
      complianceDeadline: input.ownership.complianceDeadline,
    },
    care: {
      status: input.care.status,
      lastVetVisit: input.care.lastVetVisit,
    },
    documents,
    attachments,
    seller: {
      name: input.seller.name,
      ranch: input.seller.ranch,
      email: input.seller.email,
      heroPhotoUrl: input.seller.heroPhotoUrl,
      heroPhotoDigest: input.seller.heroPhotoDigest,
    },
    verifiedProofs: [...input.verifiedProofs].sort(),
    sealedAt: input.sealedAt,
    sealedBy: input.sealedBy,
  };

  return canonicalStringify(payload);
}

/** Group the leading hex of a digest into a short, human-readable seal code that
 * a person can compare at a glance or read aloud. Not a separate secret — purely
 * a friendly view of the first 12 digest characters. */
export function sealCodeFromDigest(digest: string): string {
  const head = digest.slice(0, 12).toUpperCase();
  return `SEAL-${head.slice(0, 4)}-${head.slice(4, 8)}-${head.slice(8, 12)}`;
}

/** Buyer-facing registration line. A registered flag with no registry name on
 * file must never render the literal word "registry" — a placeholder-looking
 * fallback inside sealed facts a buyer reads as the document's own words.
 * And a registered flag with no number must never claim a number is on file:
 * the seal covers alteration, not truthfulness, so inventing certainty here
 * would launder a guess into a verified fact. */
function registrationLine(identity: CredentialIdentity): string {
  if (!identity.registered) return 'Registration: not registered';
  const registry = (identity.registry || '').trim();
  const number = (identity.registrationNumber || '').trim();
  if (registry && number) return `Registration: ${registry} ${number}`;
  if (number) return `Registration: ${number}`;
  if (registry) return `Registration: ${registry} (number not on file)`;
  return 'Registration: registered (number not on file)';
}

/** Buyer-facing care line. The sealed care facts are the status and the last
 * vet visit, so the manifest names them instead of saying nothing. */
function careLine(care: CredentialCare): string {
  const status = (care.status || '').trim() || 'not on file';
  const lastVetVisit = (care.lastVetVisit || '').trim() || 'not on file';
  return `Care summary: ${status} · last vet visit ${lastVetVisit}`;
}

/** Buyer-facing ownership-proof line. When nothing was verified at seal time
 * the manifest says what the buyer should do instead of reading as a negative. */
function verifiedProofsLine(verifiedProofs: string[]): string {
  if (verifiedProofs.length) {
    return `Verified proofs: ${[...verifiedProofs].sort().join(', ')}`;
  }
  return 'Ownership proofs: none verified at seal time — confirm the underlying documents with the seller';
}

/**
 * Buyer-facing attribution line. The sealed watermark is required, and its
 * resolver falls back to the platform name when no buyer is named — which
 * traces to nobody. The manifest reads "General copy" in that case rather than
 * printing an attribution to a buyer who does not exist, and never
 * "(watermark)" implementation jargon.
 */
function issuedToLine(watermark: string): string {
  const named = (watermark || '').trim();
  const issuedTo = named === '' || named === 'XBAR' ? 'General copy' : named;
  return `Issued to: ${issuedTo}`;
}

/** Buyer-facing seller-contact line. The packet's "Contact the seller" section is
 * buyer-visible, so the seal names exactly what it shows — a swapped email or
 * photo URL after sealing must read as a different sealed fact, not as the
 * same packet. */
function sellerLine(seller: CredentialSeller): string {
  const contact = [seller.name, seller.ranch, seller.email].filter(Boolean).join(' · ') || 'not provided';
  const photo = !seller.heroPhotoUrl
    ? 'no photo'
    : seller.heroPhotoDigest
      ? 'photo sealed by content digest'
      : 'photo sealed by URL';
  return `Seller contact: ${contact} · hero ${photo}`;
}

function buildManifest(input: SaleCredentialInput): string[] {
  return [
    `Identity: ${input.identity.name || 'unnamed'} (${input.passportId})`,
    registrationLine(input.identity),
    `Sale terms: ${input.sale.askPrice > 0 ? `$${input.sale.askPrice.toLocaleString()}` : 'no ask price'} · ${
      input.sale.listingState || 'unlisted'
    }`,
    `Ownership: ${input.ownership.legalOwner || 'unknown'} · transfer ${input.ownership.transferStatus || 'unknown'}`,
    careLine(input.care),
    sellerLine(input.seller),
    `Proof documents sealed: ${input.documents.length}`,
    input.attachments.length
      ? `Embedded files sealed by content: ${input.attachments.length}`
      : 'Embedded files: none in this packet',
    verifiedProofsLine(input.verifiedProofs),
    // Displayed beside the seal so the buyer can read who this copy was issued
    // to out of the SEALED record, rather than off the watermark on the page —
    // which is the copy an altered packet would have changed.
    issuedToLine(input.watermark),
  ];
}

/** Seal a sale packet: fingerprint every covered fact into one digest. */
export function buildSaleCredential(input: SaleCredentialInput): SaleCredential {
  const payload = buildCredentialPayload(input);
  const digest = sha256(payload);
  return {
    version: SALE_CREDENTIAL_VERSION,
    passportId: input.passportId,
    digest,
    sealCode: sealCodeFromDigest(digest),
    sealedAt: input.sealedAt,
    sealedBy: input.sealedBy,
    manifest: buildManifest(input),
    payload,
  };
}

export interface CredentialVerification {
  valid: boolean;
  /** The digest recomputed from the supplied payload. */
  digest: string;
  sealCode: string;
}

/**
 * Recompute the digest from a published payload and compare it to a digest the
 * caller supplies. `valid` is true only when they match exactly — any alteration
 * to the payload flips it to false.
 *
 * IMPORTANT: this proves the payload matches THIS digest; it does not
 * authenticate where the digest came from. The caller must supply a digest
 * obtained through a trusted channel (the seal code the seller communicates, or
 * XBAR's server-anchored record) for the result to mean "unaltered since the
 * seller sealed it." Fed a digest re-derived from the same edited bundle, it
 * cannot detect a seller who re-seals forged facts — that is what server
 * anchoring, the documented follow-on, adds.
 */
export function verifySaleCredential(payload: string, expectedDigest: string): CredentialVerification {
  const digest = sha256(payload);
  return {
    valid: digest === expectedDigest,
    digest,
    sealCode: sealCodeFromDigest(digest),
  };
}
