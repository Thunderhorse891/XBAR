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

export const SERVER_SALE_CREDENTIAL_VERSION = 1;

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
export function buildServerCredentialPayload({ packetId, horseId, context, ownershipRecord, documents, sealedAt }) {
  const horse = context?.horse ?? {};
  const health = context?.health ?? {};
  const workspace = context?.workspace ?? {};
  const docs = (documents || [])
    .map((doc) => ({ id: str(doc.document_id), type: str(doc.document_type), title: str(doc.title) }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

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
    },
    health: {
      lastCogginsDate: str(health.lastCogginsDate),
      nextCogginsDue: str(health.nextCogginsDue),
      lastExamDate: str(health.lastExamDate),
    },
    documents: docs,
    workspace: {
      businessName: str(workspace.businessName),
      ranchName: str(workspace.ranchName),
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
