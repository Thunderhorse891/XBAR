import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { toPacketDisclosure } from '../src/lib/salePacketDisclosure.js';
import type { HorseRecord, OwnershipRecord, WorkspaceProfile } from '../src/types/xbar.js';

/*
 * A buyer sale packet was rendered straight from the whole `HorseRecord`.
 *
 * That put three classes of thing into a document emailed to a stranger: the
 * seller's own negotiating position (buyer confidence, watchlist and inquiry
 * counts), two third parties' names, and an internal free-text notes field.
 * `publicShare.ts` had already decided the first of those was not buyer-facing
 * — it zeroes exactly those three counts — so the packet contradicted a rule
 * the codebase had made.
 */

/** A record stuffed with things a buyer must never receive. */
function privateHorse(): HorseRecord {
  return {
    id: 'h1',
    name: 'Thunderhorse',
    barnName: 'Thunder',
    breed: 'Quarter Horse',
    sex: 'Gelding',
    color: 'Bay',
    markings: 'Star',
    foaledOn: '2019-04-02',
    age: 7,
    registered: true,
    registry: 'AQHA',
    registrationNumber: 'X1234567',
    microchipId: '985141000123456',
    owner: 'Erin Wyrick',
    ownerEntity: '',
    status: 'Pasture',
    lastVetVisit: '2026-06-01',
    medicalNotes: 'PRIVATE-NOTES lame left fore, do not disclose to buyers',
    bloodline: { sire: 'Smokin Whiz', dam: 'Docs Starlight' },
    assignments: { veterinarian: 'PRIVATE-VET Dr Vasquez', farrier: 'PRIVATE-FARRIER J Reed' },
    sale: { askPrice: 42000, listingState: 'Listed', buyerConfidence: 91, watchlistCount: 7, inquiryCount: 3 },
  } as unknown as HorseRecord;
}

function ownership(): OwnershipRecord {
  return {
    legalOwner: 'Rocking R Ranch LLC',
    transferStatus: 'Clear',
    pendingDocuments: [],
    complianceDeadline: '',
  } as unknown as OwnershipRecord;
}

const workspace = { defaultOwnerEntity: 'XBAR LLC' } as unknown as WorkspaceProfile;

test('a buyer disclosure carries nothing private about the seller or third parties', () => {
  const serialized = JSON.stringify(toPacketDisclosure(privateHorse(), ownership(), workspace));

  for (const secret of ['PRIVATE-NOTES', 'PRIVATE-VET', 'PRIVATE-FARRIER']) {
    assert.ok(!serialized.includes(secret), `${secret} must never reach a buyer-facing packet`);
  }

  // The seller's negotiating position, handed to the party negotiating against
  // them. "Inquiries: 0" on a packet costs the seller money.
  assert.ok(!serialized.includes('buyerConfidence'), 'buyer confidence is the seller position, not a buyer fact');
  assert.ok(!serialized.includes('watchlistCount'), 'watchlist count is the seller position');
  assert.ok(!serialized.includes('inquiryCount'), 'inquiry count is the seller position');
  assert.ok(!serialized.includes('91'), 'the confidence VALUE must not survive under another key either');
});

test('a buyer disclosure still answers what a buyer came for', () => {
  const disclosure = toPacketDisclosure(privateHorse(), ownership(), workspace);

  // Deliberately included, and the cloud packet ships these too. A packet that
  // withheld them would be private and useless: the microchip is how a buyer
  // confirms the horse in the trailer is the horse in the papers, and you
  // cannot buy a horse without knowing who is selling it.
  assert.equal(disclosure.identity.microchipId, '985141000123456');
  assert.equal(disclosure.ownership.legalOwner, 'Rocking R Ranch LLC');
  assert.equal(disclosure.ownership.transferStatus, 'Clear');
  assert.equal(disclosure.sale.askPrice, 42000);
  assert.equal(disclosure.sale.listingState, 'Listed');

  // A date, not a diagnosis. The diagnosis is in the vet record the seller
  // deliberately attached, where a buyer reads it in full and in context.
  assert.equal(disclosure.care.lastVetVisit, '2026-06-01');
  assert.equal(disclosure.care.status, 'Pasture');
});

test('the owner entity falls back to the workspace, as the packet prints it', () => {
  // The rendered page shows this fallback, so a credential sealed without the
  // workspace profile would cover a different owner entity than the page shows.
  assert.equal(toPacketDisclosure(privateHorse(), ownership(), workspace).ownership.ownerEntity, 'XBAR LLC');
});

test('a field added to the record tomorrow is not disclosed by default', () => {
  const horse = { ...privateHorse(), someNewInternalField: 'PRIVATE-FUTURE' } as unknown as HorseRecord;
  const serialized = JSON.stringify(toPacketDisclosure(horse, ownership(), workspace));

  // The whole reason this is an allowlist rather than a redaction list. A
  // blocklist protects against the fields someone remembered.
  assert.ok(!serialized.includes('PRIVATE-FUTURE'));
  assert.ok(!serialized.includes('someNewInternalField'));
});

test('the packet renders and seals from the disclosure, never from the record', async () => {
  const generator = await readFile('src/lib/localSalePacketGenerator.ts', 'utf8');

  for (const forbidden of [
    'params.horse.medicalNotes',
    'params.horse.assignments',
    'params.horse.sale.buyerConfidence',
    'params.horse.sale.watchlistCount',
    'params.horse.sale.inquiryCount',
  ]) {
    assert.ok(!generator.includes(forbidden), `the packet must not read ${forbidden}`);
  }

  // One object, built once, rendered from AND sealed from — not two derivations
  // that happen to agree until one call site forgets an argument.
  assert.match(
    generator,
    /const shown = toPacketDisclosure\(params\.horse, params\.ownershipRecord, params\.workspaceProfile\);/,
  );
  assert.match(generator, /disclosure: shown,/, 'the credential must seal the object the page renders');
});

test('the sealed payload cannot carry what the page may not show', async () => {
  const credential = await readFile('src/lib/saleCredential.ts', 'utf8');

  /*
   * This matters more than it looks. The payload is now published verbatim
   * inside the packet so a buyer can recompute the digest — which makes
   * everything sealed also everything DISCLOSED. Leaving the medical notes in
   * `CredentialCare` would have leaked them in the verification block even
   * after the visible table stopped showing them.
   */
  const care = credential.slice(credential.indexOf('export interface CredentialCare'));
  const body = care.slice(0, care.indexOf('}'));
  assert.ok(!body.includes('veterinarian'), 'a third party name must not be sealed into a published payload');
  assert.ok(!body.includes('farrier'), 'a third party name must not be sealed into a published payload');
  assert.ok(
    !body.includes('medicalNotes'),
    'unreviewed internal free text must not be sealed into a published payload',
  );
});
