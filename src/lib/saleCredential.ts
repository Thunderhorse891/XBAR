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

export const SALE_CREDENTIAL_VERSION = 2 as const;

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
  owner: string;
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
export interface CredentialCare {
  status: string;
  lastVetVisit: string;
  veterinarian: string;
  farrier: string;
  medicalNotes: string;
}

/** Release-gate verdict the packet renders. */
export interface CredentialRelease {
  status: string;
  allowed: boolean;
  blockers: string[];
  warnings: string[];
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
  release: CredentialRelease;
  /** Human labels of the ownership proofs that were VERIFIED at seal time. */
  verifiedProofs: string[];
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
      owner: input.identity.owner,
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
      veterinarian: input.care.veterinarian,
      farrier: input.care.farrier,
      medicalNotes: input.care.medicalNotes,
    },
    documents,
    attachments,
    release: {
      status: input.release.status,
      allowed: input.release.allowed,
      blockers: [...input.release.blockers].sort(),
      warnings: [...input.release.warnings].sort(),
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

function buildManifest(input: SaleCredentialInput): string[] {
  return [
    `Identity: ${input.identity.name || 'unnamed'} (${input.passportId})`,
    input.identity.registered
      ? `Registration: ${input.identity.registry || 'registry'} ${input.identity.registrationNumber || ''}`.trim()
      : 'Registration: not registered',
    `Sale terms: ${input.sale.askPrice > 0 ? `$${input.sale.askPrice.toLocaleString()}` : 'no ask price'} · ${
      input.sale.listingState || 'unlisted'
    }`,
    `Ownership: ${input.ownership.legalOwner || 'unknown'} · transfer ${input.ownership.transferStatus || 'unknown'}`,
    `Care & disclosure summary sealed`,
    `Proof documents sealed: ${input.documents.length}`,
    input.attachments.length
      ? `Embedded files sealed by content: ${input.attachments.length}`
      : 'Embedded files: none in this packet',
    input.verifiedProofs.length
      ? `Verified proofs: ${[...input.verifiedProofs].sort().join(', ')}`
      : 'Verified proofs: none verified at seal time',
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
