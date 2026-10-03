// Server-side sale credential — the tamper-PROOF anchor.
//
// The client-side credential (src/lib/saleCredential.ts) is tamper-EVIDENT: it
// fingerprints the facts a packet shows, but it is computed and checked from the
// same bundle, so on its own it cannot stop a seller who re-seals forged facts.
//
// This module closes that gap for cloud (Professional+) packets. It runs only on
// the server, over data read straight from the workspace's authoritative tables
// (horses, ownership_records, documents, workspace_profiles) — NOT over anything
// the client submits. The resulting digest is stored on the sale_packets row and
// returned to the client. Because the seller can only change those source rows
// through authenticated, RLS-guarded, audited writes, the seal reflects what
// XBAR's own records said at seal time. A buyer who later verifies a packet
// against XBAR's stored seal gets a guarantee the seller cannot forge from the
// delivered bundle alone.
//
// Node's built-in crypto provides SHA-256 here; the client uses a hand-rolled
// SHA-256 for the same algorithm in the browser. Both hash a canonical
// (key-sorted, array-ordered) JSON string, so a given fact set always yields the
// same digest.

import { createHash } from 'node:crypto';

/** Seller-recorded attestations only. Never describes XBAR as the reviewer. */
export function ownershipReviewSummary(ownershipRecord, documents = []) {
  const requirements = Array.isArray(ownershipRecord?.payload?.proofRequirements)
    ? ownershipRecord.payload.proofRequirements
    : [];
  if (!requirements.length)
    return 'No human source review is recorded. XBAR does not independently verify legal ownership.';
  const reviewed = requirements.filter((item) => {
    const doc = documents.find((document) => document.document_id === item.documentId && document.state === 'Ready');
    const source = doc?.payload;
    if (
      !source ||
      source.id !== doc.document_id ||
      source.horseId !== doc.horse_id ||
      source.type !== doc.document_type ||
      source.identityReviewRequired ||
      (source.duplicateRisk === 'Possible Duplicate' && !source.duplicateReviewedAt) ||
      source.processingNote?.trim()
    )
      return false;
    // Identical ordered fields to ownershipDocumentReviewKey on the client.
    const sourceKey = createHash('sha256')
      .update(
        JSON.stringify([
          source.id,
          source.horseId ?? '',
          source.type,
          source.contentSha256 ?? '',
          source.storagePath ?? '',
          source.localFileKey ?? '',
          source.fileUrl ?? '',
          source.extractedTextPreview,
        ]),
      )
      .digest('hex');
    return (
      item.status === 'verified' &&
      typeof item.verifiedBy === 'string' &&
      item.verifiedBy.trim() &&
      item.verifiedAt &&
      item.reviewAttestedAt &&
      item.reviewedSourceKey === sourceKey
    );
  }).length;
  return `${reviewed} of ${requirements.length} ownership source reviews recorded by the seller's team. XBAR does not independently verify legal ownership.`;
}

export const SERVER_SALE_CREDENTIAL_VERSION = 3;

/** Deterministic JSON: object keys sorted, arrays kept in caller order. */
function canonicalStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(',')}}`;
}

/** Group the digest head into a readable seal code, matching the client format
 * (src/lib/saleCredential.ts sealCodeFromDigest) so both display identically. */
export function serverSealCode(digest) {
  const head = String(digest).slice(0, 12).toUpperCase();
  return `SEAL-${head.slice(0, 4)}-${head.slice(4, 8)}-${head.slice(8, 12)}`;
}

function str(value) {
  return typeof value === 'string' ? value : value == null ? '' : String(value);
}

/**
 * Build the canonical payload the digest is computed over, entirely from
 * server-authoritative inputs. `documents` are the metadata rows actually
 * bundled into the packet (server-selected), sorted by id so ordering never
 * changes the seal.
 */
export function buildServerCredentialPayload({
  packetId,
  horseId,
  context,
  ownershipRecord,
  reviewDocuments,
  documents,
  sealedAt,
  sellerIdentity,
  packetBranding,
}) {
  const horse = context?.horse ?? {};
  const health = context?.health ?? {};
  const workspace = context?.workspace ?? {};
  const docs = (documents || [])
    .map((doc) => ({ id: str(doc.document_id), type: str(doc.document_type), title: str(doc.title) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // The sealed seller names are the SAME filtered identity the PDF cover
  // renders: the caller filters through api/_lib/workspace-identity.js before
  // sealing, so the seal never authenticates a quick-start placeholder the
  // cover omits. Without an explicit identity the raw workspace names are
  // sealed, as before.
  const identity = packetBranding ?? sellerIdentity ?? {};
  const branding = packetBranding ?? {};

  const payload = {
    version: SERVER_SALE_CREDENTIAL_VERSION,
    packetId: str(packetId),
    horseId: str(horseId),
    horse: {
      name: str(horse.name),
      barnName: str(horse.barnName),
      registrationNumber: str(horse.registrationNumber),
      registry: str(horse.registry),
      breed: str(horse.breed),
      color: str(horse.color),
      birthdate: str(horse.birthdate),
      gender: str(horse.gender),
      microchip: str(horse.microchip),
    },
    owner: {
      legalOwner: str(context?.owner?.name),
    },
    transfer: {
      status: str(ownershipRecord?.transfer_status),
      complianceDeadline: str(ownershipRecord?.compliance_deadline),
      reviewSummary: ownershipReviewSummary(ownershipRecord, reviewDocuments ?? documents),
    },
    health: {
      lastCogginsDate: str(health.lastCogginsDate),
      nextCogginsDue: str(health.nextCogginsDue),
      lastExamDate: str(health.lastExamDate),
    },
    documents: docs,
    workspace: {
      businessName: str(identity.business ?? workspace.businessName),
      ranchName: str(identity.ranch ?? workspace.ranchName),
    },
    // Immutable buyer-facing snapshot. The logo bytes are covered through
    // their canonical inline data URL, not a mutable remote URL.
    seller: {
      name: str(branding.name),
      displayName: str(branding.displayName),
      email: str(branding.email),
      phone: str(branding.phone),
      website: str(branding.website),
      logoDataUrl: str(branding.logoDataUrl),
      logoDigest: branding.logoBytes ? createHash('sha256').update(branding.logoBytes).digest('hex') : '',
    },
    sealedAt: str(sealedAt),
  };

  return canonicalStringify(payload);
}

/**
 * Seal a packet from server-authoritative data. Returns the seal to store on the
 * sale_packets row and return to the client. `payload` is the exact canonical
 * string that was hashed, kept so a later verification can recompute and compare.
 */
export function buildServerSaleCredential(input) {
  const payload = buildServerCredentialPayload(input);
  const digest = createHash('sha256').update(payload, 'utf8').digest('hex');
  return {
    version: SERVER_SALE_CREDENTIAL_VERSION,
    anchor: 'server',
    digest,
    sealCode: serverSealCode(digest),
    sealedAt: str(input.sealedAt),
    payload,
  };
}
