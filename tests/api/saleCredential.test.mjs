import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  SERVER_SALE_CREDENTIAL_VERSION,
  buildServerCredentialPayload,
  buildServerSaleCredential,
  serverSealCode,
} from '../../api/_lib/sale-credential.js';

/*
 * The server-side seal is the tamper-PROOF anchor: it is computed here from
 * workspace-authoritative records (never from client input) and stored on the
 * sale_packets row. These tests lock its determinism and that every covered fact
 * is bound into the digest.
 */

function input(overrides = {}) {
  return {
    packetId: 'packet-abc',
    horseId: 'horse-1',
    context: {
      horse: {
        name: 'Docs Smokin Gun',
        barnName: 'Smoke',
        registrationNumber: 'X0099887',
        registry: 'AQHA',
        breed: 'Quarter Horse',
        color: 'Bay',
        birthdate: '2019-04-01',
        gender: 'Mare',
        microchip: '985141000123456',
      },
      owner: { name: 'Rocking R Ranch LLC' },
      health: { lastCogginsDate: '2026-01-10', nextCogginsDue: '2027-01-10', lastExamDate: '2026-06-01' },
      workspace: { businessName: 'Rocking R', ranchName: 'Rocking R Ranch' },
    },
    ownershipRecord: { transfer_status: 'Clear', compliance_deadline: '' },
    documents: [
      { document_id: 'doc-2', document_type: 'Coggins', title: 'Coggins 2026' },
      { document_id: 'doc-1', document_type: 'Registration', title: 'AQHA Certificate' },
    ],
    sealedAt: '2026-08-06T12:00:00.000Z',
    ...overrides,
  };
}

test('server seal is deterministic and anchored', () => {
  const a = buildServerSaleCredential(input());
  const b = buildServerSaleCredential(input());
  assert.equal(a.digest, b.digest);
  assert.equal(a.sealCode, b.sealCode);
  assert.equal(a.anchor, 'server');
  assert.equal(a.version, SERVER_SALE_CREDENTIAL_VERSION);
  assert.match(a.digest, /^[0-9a-f]{64}$/);
});

test('digest is a real SHA-256 of the returned payload', () => {
  const seal = buildServerSaleCredential(input());
  const expected = createHash('sha256').update(seal.payload, 'utf8').digest('hex');
  assert.equal(seal.digest, expected);
});

test('document order does not change the seal', () => {
  const forward = buildServerSaleCredential(input());
  const reversed = buildServerSaleCredential(
    input({
      documents: [
        { document_id: 'doc-1', document_type: 'Registration', title: 'AQHA Certificate' },
        { document_id: 'doc-2', document_type: 'Coggins', title: 'Coggins 2026' },
      ],
    }),
  );
  assert.equal(forward.digest, reversed.digest);
});

test('changing the legal owner changes the seal', () => {
  const base = buildServerSaleCredential(input());
  const changed = buildServerSaleCredential(
    input({ context: { ...input().context, owner: { name: 'Someone Else' } } }),
  );
  assert.notEqual(base.digest, changed.digest);
});

test('changing the transfer status changes the seal', () => {
  const base = buildServerSaleCredential(input());
  const changed = buildServerSaleCredential(
    input({ ownershipRecord: { transfer_status: 'Pending Signatures', compliance_deadline: '' } }),
  );
  assert.notEqual(base.digest, changed.digest);
});

test('swapping a document changes the seal', () => {
  const base = buildServerSaleCredential(input());
  const swapped = buildServerSaleCredential(
    input({
      documents: [
        { document_id: 'doc-2', document_type: 'Coggins', title: 'Coggins 2026' },
        { document_id: 'doc-9', document_type: 'Bill of Sale', title: 'Forged bill' },
      ],
    }),
  );
  assert.notEqual(base.digest, swapped.digest);
});

test('changing the microchip changes the seal', () => {
  const base = buildServerSaleCredential(input());
  const changed = buildServerSaleCredential(
    input({ context: { ...input().context, horse: { ...input().context.horse, microchip: '000' } } }),
  );
  assert.notEqual(base.digest, changed.digest);
});

test('seal code is a readable grouping of the digest head', () => {
  assert.equal(
    serverSealCode('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'),
    'SEAL-BA78-16BF-8F01',
  );
});

test('payload is canonical JSON with sorted top-level keys and tolerates missing inputs', () => {
  const payload = buildServerCredentialPayload({ packetId: 'p', horseId: 'h', sealedAt: '2026-01-01T00:00:00.000Z' });
  const parsed = JSON.parse(payload);
  const keys = Object.keys(parsed);
  assert.deepEqual(keys, [...keys].sort());
  // Missing context/documents must not throw and must serialize as empty facts.
  assert.equal(parsed.owner.legalOwner, '');
  assert.deepEqual(parsed.documents, []);
});
