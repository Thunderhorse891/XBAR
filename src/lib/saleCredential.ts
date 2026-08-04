// Verifiable Sale Credential — a tamper-evident fingerprint for a sale packet.
//
// The problem it solves: today a buyer looking at an XBAR sale packet has to
// *take the seller's word* that the identity, ownership, transfer status, and
// proof documents are what they say — and that nothing was quietly changed after
// the packet was sent. This credential makes that verifiable.
//
// How it works, honestly:
//   1. We collect exactly the buyer-facing facts a packet asserts — the
//      buyer-safe passport identity, the fingerprints of the included proof
//      documents, the ownership/transfer state, the release-gate verdict, and
//      which ownership proofs were VERIFIED at seal time.
//   2. We serialize them canonically (keys sorted, arrays ordered) so the same
//      facts always produce the same bytes, regardless of insertion order.
//   3. We SHA-256 those bytes into a single digest, and publish it as the seal.
//
// What the seal proves: every covered fact is bound together into one
// fingerprint. If ANY of them changes — a swapped document, an edited transfer
// status, a downgraded proof — the recomputed digest no longer matches the
// published seal, and `verifySaleCredential` reports a mismatch. That is
// genuine tamper-EVIDENCE: alterations cannot hide.
//
// What it does NOT (yet) claim: this v1 digest is computed and checked from the
// published bundle itself, so it detects alteration but is not, on its own,
// proof against a seller who re-seals forged facts. Anchoring the digest
// server-side at share time (so the buyer verifies against XBAR, not the
// bundle) is the follow-on that upgrades tamper-evidence to tamper-PROOF. The
// UI copy states exactly this and never overclaims.

import { sha256 } from './sha256.js';
import type { PublicPassportDTO } from './buyerSafePassport.js';

export const SALE_CREDENTIAL_VERSION = 1 as const;

/** Buyer-facing fingerprint of one included proof document. No file bytes are
 * required — identity, type, title and upload date pin which document was in the
 * packet, so a later swap for a different document changes the digest. */
export interface CredentialDocument {
  id: string;
  type: string;
  title: string;
  uploadedAt: string;
}

/** Buyer-facing ownership/transfer facts the seal covers. */
export interface CredentialOwnership {
  legalOwner: string;
  transferStatus: string;
}

/** Release-gate verdict the seal covers. */
export interface CredentialRelease {
  status: string;
  allowed: boolean;
}

export interface SaleCredentialInput {
  passport: PublicPassportDTO;
  documents: CredentialDocument[];
  ownership: CredentialOwnership;
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
  /** The exact canonical string that was hashed. Republished so a buyer can
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
 * that have no inherent order (documents, verified proofs) are sorted here so a
 * reordering of the same facts never changes the seal. */
export function buildCredentialPayload(input: SaleCredentialInput): string {
  const documents = [...input.documents]
    .map((doc) => ({ id: doc.id, type: doc.type, title: doc.title, uploadedAt: doc.uploadedAt }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const verifiedProofs = [...input.verifiedProofs].sort();

  const payload: Json = {
    version: SALE_CREDENTIAL_VERSION,
    passport: {
      passportId: input.passport.passportId,
      name: input.passport.name,
      breed: input.passport.breed,
      sex: input.passport.sex,
      color: input.passport.color,
      markings: input.passport.markings,
      foaledOn: input.passport.foaledOn,
      age: input.passport.age,
      registered: input.passport.registered,
      registry: input.passport.registry,
      registrationNumber: input.passport.registrationNumber,
      sire: input.passport.sire,
      dam: input.passport.dam,
    },
    documents,
    ownership: {
      legalOwner: input.ownership.legalOwner,
      transferStatus: input.ownership.transferStatus,
    },
    release: {
      status: input.release.status,
      allowed: input.release.allowed,
    },
    verifiedProofs,
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
  const manifest = [
    `Identity: ${input.passport.name || 'unnamed'} (${input.passport.passportId})`,
    input.passport.registered
      ? `Registration: ${input.passport.registry || 'registry'} ${input.passport.registrationNumber || ''}`.trim()
      : 'Registration: not registered',
    `Ownership: ${input.ownership.legalOwner || 'unknown'} · transfer ${input.ownership.transferStatus || 'unknown'}`,
    `Release status: ${input.release.status}`,
    `Proof documents sealed: ${input.documents.length}`,
    input.verifiedProofs.length
      ? `Verified proofs: ${[...input.verifiedProofs].sort().join(', ')}`
      : 'Verified proofs: none verified at seal time',
  ];
  return manifest;
}

/** Seal a sale packet: fingerprint every covered fact into one digest. */
export function buildSaleCredential(input: SaleCredentialInput): SaleCredential {
  const payload = buildCredentialPayload(input);
  const digest = sha256(payload);
  return {
    version: SALE_CREDENTIAL_VERSION,
    passportId: input.passport.passportId,
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

/** Recompute the digest from a published payload and compare it to the seal that
 * was published with it. `valid` is true only when they match exactly — any
 * alteration to the payload flips it to false. */
export function verifySaleCredential(payload: string, expectedDigest: string): CredentialVerification {
  const digest = sha256(payload);
  return {
    valid: digest === expectedDigest,
    digest,
    sealCode: sealCodeFromDigest(digest),
  };
}
