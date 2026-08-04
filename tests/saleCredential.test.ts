import assert from 'node:assert/strict';
import test from 'node:test';
import type { PublicPassportDTO } from '../src/lib/buyerSafePassport.js';
import {
  type SaleCredentialInput,
  buildCredentialPayload,
  buildSaleCredential,
  sealCodeFromDigest,
  verifySaleCredential,
} from '../src/lib/saleCredential.js';

function passport(overrides: Partial<PublicPassportDTO> = {}): PublicPassportDTO {
  return {
    passportId: 'XB-7Q2K-9F3M',
    name: 'Docs Smokin Gun',
    breed: 'Quarter Horse',
    sex: 'Mare',
    color: 'Bay',
    markings: 'Star',
    foaledOn: '2019-04-01',
    age: 6,
    registered: true,
    registry: 'AQHA',
    registrationNumber: 'X0099887',
    sire: 'Smokin Whiz',
    dam: 'Docs Starlight',
    photoUrl: 'https://example.test/hero.jpg',
    ...overrides,
  };
}

function input(overrides: Partial<SaleCredentialInput> = {}): SaleCredentialInput {
  return {
    passport: passport(),
    documents: [
      { id: 'doc-2', type: 'Coggins', title: 'Coggins 2026', uploadedAt: '2026-01-10' },
      { id: 'doc-1', type: 'Registration', title: 'AQHA Certificate', uploadedAt: '2025-12-01' },
    ],
    ownership: { legalOwner: 'Rocking R Ranch LLC', transferStatus: 'Clear' },
    release: { status: 'Ready to release', allowed: true },
    verifiedProofs: ['Registration certificate', 'Bill of sale'],
    sealedAt: '2026-08-04T12:00:00.000Z',
    sealedBy: 'erin@rockingr.test',
    ...overrides,
  };
}

test('sealing the same facts is deterministic', () => {
  const a = buildSaleCredential(input());
  const b = buildSaleCredential(input());
  assert.equal(a.digest, b.digest);
  assert.equal(a.sealCode, b.sealCode);
  assert.equal(a.digest.length, 64);
  assert.match(a.digest, /^[0-9a-f]{64}$/);
});

test('document order does not change the seal', () => {
  const forward = buildSaleCredential(input());
  const reversed = buildSaleCredential(
    input({
      documents: [
        { id: 'doc-1', type: 'Registration', title: 'AQHA Certificate', uploadedAt: '2025-12-01' },
        { id: 'doc-2', type: 'Coggins', title: 'Coggins 2026', uploadedAt: '2026-01-10' },
      ],
    }),
  );
  assert.equal(forward.digest, reversed.digest);
});

test('verified-proof order does not change the seal', () => {
  const forward = buildSaleCredential(input());
  const reordered = buildSaleCredential(input({ verifiedProofs: ['Bill of sale', 'Registration certificate'] }));
  assert.equal(forward.digest, reordered.digest);
});

test('changing any covered identity fact changes the seal', () => {
  const base = buildSaleCredential(input());
  const tampered = buildSaleCredential(input({ passport: passport({ name: 'Different Horse' }) }));
  assert.notEqual(base.digest, tampered.digest);
});

test('swapping a proof document changes the seal', () => {
  const base = buildSaleCredential(input());
  const swapped = buildSaleCredential(
    input({
      documents: [
        { id: 'doc-2', type: 'Coggins', title: 'Coggins 2026', uploadedAt: '2026-01-10' },
        { id: 'doc-9', type: 'Bill of Sale', title: 'Forged bill', uploadedAt: '2026-02-01' },
      ],
    }),
  );
  assert.notEqual(base.digest, swapped.digest);
});

test('downgrading a verified proof changes the seal', () => {
  const base = buildSaleCredential(input());
  const downgraded = buildSaleCredential(input({ verifiedProofs: ['Registration certificate'] }));
  assert.notEqual(base.digest, downgraded.digest);
});

test('transfer status is bound into the seal', () => {
  const clear = buildSaleCredential(input());
  const pending = buildSaleCredential(
    input({ ownership: { legalOwner: 'Rocking R Ranch LLC', transferStatus: 'Pending Signatures' } }),
  );
  assert.notEqual(clear.digest, pending.digest);
});

test('verifySaleCredential accepts the untouched payload and rejects an edited one', () => {
  const credential = buildSaleCredential(input());
  const good = verifySaleCredential(credential.payload, credential.digest);
  assert.equal(good.valid, true);
  assert.equal(good.digest, credential.digest);

  // A buyer receives the payload but someone edits "Clear" -> "Pending" in it.
  const edited = credential.payload.replace('Clear', 'Pending Signatures');
  assert.notEqual(edited, credential.payload);
  const bad = verifySaleCredential(edited, credential.digest);
  assert.equal(bad.valid, false);
  assert.notEqual(bad.digest, credential.digest);
});

test('seal code is a readable grouping of the digest head', () => {
  const digest = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
  assert.equal(sealCodeFromDigest(digest), 'SEAL-BA78-16BF-8F01');
});

test('manifest reports the real document and proof counts', () => {
  const credential = buildSaleCredential(input());
  assert.ok(credential.manifest.some((line) => line.includes('Proof documents sealed: 2')));
  assert.ok(
    credential.manifest.some((line) => line.includes('Verified proofs: Bill of sale, Registration certificate')),
  );
});

test('an unregistered horse states so in the manifest without inventing registry data', () => {
  const credential = buildSaleCredential(
    input({ passport: passport({ registered: false, registry: '', registrationNumber: '' }) }),
  );
  assert.ok(credential.manifest.some((line) => line === 'Registration: not registered'));
});

test('payload is canonical JSON with sorted top-level keys', () => {
  const payload = buildCredentialPayload(input());
  const parsed = JSON.parse(payload) as Record<string, unknown>;
  const keys = Object.keys(parsed);
  assert.deepEqual(keys, [...keys].sort());
});
