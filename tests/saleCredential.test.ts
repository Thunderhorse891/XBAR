import assert from 'node:assert/strict';
import test from 'node:test';
import {
  type CredentialDocument,
  type SaleCredentialInput,
  buildCredentialPayload,
  buildSaleCredential,
  sealCodeFromDigest,
  verifySaleCredential,
} from '../src/lib/saleCredential.js';
import { sha256 } from '../src/lib/sha256.js';

function docs(): CredentialDocument[] {
  return [
    {
      id: 'doc-2',
      type: 'Coggins',
      title: 'Coggins 2026',
      uploadedAt: '2026-01-10',
      summary: 'Negative',
      confidence: 96,
    },
    {
      id: 'doc-1',
      type: 'Registration',
      title: 'AQHA Certificate',
      uploadedAt: '2025-12-01',
      summary: 'On file',
      confidence: 99,
    },
  ];
}

function input(overrides: Partial<SaleCredentialInput> = {}): SaleCredentialInput {
  return {
    // Most packets embed nothing; the cases that do override this.
    attachments: [],
    passportId: 'XB-7Q2K-9F3M',
    identity: {
      name: 'Docs Smokin Gun',
      barnName: 'Smoke',
      breed: 'Quarter Horse',
      sex: 'Mare',
      color: 'Bay',
      markings: 'Star',
      foaledOn: '2019-04-01',
      age: 6,
      registered: true,
      registry: 'AQHA',
      registrationNumber: 'X0099887',
      microchipId: '985141000123456',
      sire: 'Smokin Whiz',
      dam: 'Docs Starlight',
      owner: 'Erin Wyrick',
    },
    sale: { askPrice: 45000, listingState: 'Buyer Review' },
    ownership: {
      legalOwner: 'Rocking R Ranch LLC',
      ownerEntity: 'Rocking R Ranch LLC',
      transferStatus: 'Clear',
      pendingDocuments: [],
      complianceDeadline: '',
    },
    care: {
      status: 'Sale Prep',
      lastVetVisit: '2026-06-01',
      veterinarian: 'Dr. Vasquez',
      farrier: 'J. Reed',
      medicalNotes: 'Sound; routine care current.',
    },
    documents: docs(),
    release: { status: 'Ready to release', allowed: true, blockers: [], warnings: [] },
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
  const reversed = buildSaleCredential(input({ documents: [...docs()].reverse() }));
  assert.equal(forward.digest, reversed.digest);
});

test('verified-proof order does not change the seal', () => {
  const forward = buildSaleCredential(input());
  const reordered = buildSaleCredential(input({ verifiedProofs: ['Bill of sale', 'Registration certificate'] }));
  assert.equal(forward.digest, reordered.digest);
});

test('changing any covered identity fact changes the seal', () => {
  const base = buildSaleCredential(input());
  const tampered = buildSaleCredential(input({ identity: { ...input().identity, name: 'Different Horse' } }));
  assert.notEqual(base.digest, tampered.digest);
});

test('changing the microchip changes the seal', () => {
  const base = buildSaleCredential(input());
  const tampered = buildSaleCredential(input({ identity: { ...input().identity, microchipId: '000000000000000' } }));
  assert.notEqual(base.digest, tampered.digest);
});

test('changing the ask price changes the seal', () => {
  const base = buildSaleCredential(input());
  const tampered = buildSaleCredential(input({ sale: { askPrice: 30000, listingState: 'Buyer Review' } }));
  assert.notEqual(base.digest, tampered.digest);
});

test('changing a document summary or confidence changes the seal', () => {
  const base = buildSaleCredential(input());
  const editedSummary = buildSaleCredential(
    input({
      documents: [{ ...docs()[0], summary: 'POSITIVE' }, docs()[1]],
    }),
  );
  const editedConfidence = buildSaleCredential(
    input({
      documents: [{ ...docs()[0], confidence: 10 }, docs()[1]],
    }),
  );
  assert.notEqual(base.digest, editedSummary.digest);
  assert.notEqual(base.digest, editedConfidence.digest);
});

test('changing the medical-notes disclosure changes the seal', () => {
  const base = buildSaleCredential(input());
  const tampered = buildSaleCredential(input({ care: { ...input().care, medicalNotes: 'No disclosures.' } }));
  assert.notEqual(base.digest, tampered.digest);
});

test('changing pending documents changes the seal', () => {
  const base = buildSaleCredential(input());
  const tampered = buildSaleCredential(
    input({ ownership: { ...input().ownership, pendingDocuments: ['Signed transfer form'] } }),
  );
  assert.notEqual(base.digest, tampered.digest);
});

test('swapping a proof document changes the seal', () => {
  const base = buildSaleCredential(input());
  const swapped = buildSaleCredential(
    input({
      documents: [
        docs()[0],
        {
          id: 'doc-9',
          type: 'Bill of Sale',
          title: 'Forged bill',
          uploadedAt: '2026-02-01',
          summary: '',
          confidence: 0,
        },
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
    input({ ownership: { ...input().ownership, transferStatus: 'Pending Signatures' } }),
  );
  assert.notEqual(clear.digest, pending.digest);
});

test('a release blocker is bound into the seal', () => {
  const base = buildSaleCredential(input());
  const blocked = buildSaleCredential(
    input({ release: { status: 'On hold', allowed: false, blockers: ['Coggins missing'], warnings: [] } }),
  );
  assert.notEqual(base.digest, blocked.digest);
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
    input({ identity: { ...input().identity, registered: false, registry: '', registrationNumber: '' } }),
  );
  assert.ok(credential.manifest.some((line) => line === 'Registration: not registered'));
});

test('payload is canonical JSON with sorted top-level keys', () => {
  const payload = buildCredentialPayload(input());
  const parsed = JSON.parse(payload) as Record<string, unknown>;
  const keys = Object.keys(parsed);
  assert.deepEqual(keys, [...keys].sort());
});

test('swapping an embedded file breaks the seal', () => {
  const file = {
    id: 'doc-1',
    fileName: 'coggins-2026.pdf',
    sizeBytes: 18,
    digest: sha256('%PDF-1.4 NEGATIVE'),
  };

  const sealed = buildSaleCredential(input({ attachments: [file] }));

  // Same name, same size, same document metadata — different bytes. This is the
  // whole attack: once the packet carries the FILES, a seal over their titles
  // proves nothing about what the buyer opens, while the packet tells them a
  // matching seal means it is unaltered.
  const tampered = buildSaleCredential(input({ attachments: [{ ...file, digest: sha256('%PDF-1.4 FORGED') }] }));

  assert.notEqual(tampered.digest, sealed.digest);
  assert.notEqual(tampered.sealCode, sealed.sealCode);
});

test('the same files in a different read order seal identically', () => {
  const a = { id: 'doc-a', fileName: 'a.pdf', sizeBytes: 3, digest: sha256('aaa') };
  const b = { id: 'doc-b', fileName: 'b.pdf', sizeBytes: 3, digest: sha256('bbb') };

  // The vault returns files in whatever order it reads them; the seal must not
  // depend on that, or two identical packets would carry different codes.
  assert.equal(
    buildSaleCredential(input({ attachments: [a, b] })).digest,
    buildSaleCredential(input({ attachments: [b, a] })).digest,
  );
});

test('the manifest says whether files were sealed by content', () => {
  const withFiles = buildSaleCredential(
    input({ attachments: [{ id: 'doc-1', fileName: 'coggins.pdf', sizeBytes: 4, digest: sha256('abcd') }] }),
  );
  const withoutFiles = buildSaleCredential(input());

  // The manifest is printed beside the seal, so it has to distinguish "these
  // files are covered" from "this packet carries no files".
  assert.ok(withFiles.manifest.some((line) => /Embedded files sealed by content: 1/.test(line)));
  assert.ok(withoutFiles.manifest.some((line) => /Embedded files: none in this packet/.test(line)));
});

test('a packet with no embedded files still seals and verifies', () => {
  const sealed = buildSaleCredential(input());
  assert.equal(verifySaleCredential(sealed.payload, sealed.digest).valid, true);
});
