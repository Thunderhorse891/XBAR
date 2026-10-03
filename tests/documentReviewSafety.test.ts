import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDocumentRecord } from '../src/lib/xbarRuntime.js';
import type { HorseRecord } from '../src/types/xbar.js';
const horse = {
  id: 'horse-a',
  name: 'DESERT DAISY',
  barnName: '',
  registrationNumber: '7001111',
  aqhaNumber: '',
  registry: 'AQHA',
} as HorseRecord;
const paper =
  'CERTIFICATE OF REGISTRATION\nRegistered Name: DESERT DAISY\nRegistration Number: 7001111\nOwner: Taylor Ranch\nSex: Mare Color: Bay';
test('renaming the same bytes does not evade the existing-document duplicate alert', async () => {
  const first = await buildDocumentRecord({
    file: new File([paper], 'registration.txt', { type: 'text/plain' }),
    uploadedBy: 'Tester',
    source: 'Bulk Intake',
    selectedHorse: horse,
    horses: [horse],
    existingDocuments: [],
  });
  const copy = await buildDocumentRecord({
    file: new File([paper], 'another-scan.txt', { type: 'text/plain' }),
    uploadedBy: 'Tester',
    source: 'Bulk Intake',
    selectedHorse: horse,
    horses: [horse],
    existingDocuments: [first],
  });
  assert.equal(copy.duplicateRisk, 'Possible Duplicate');
  assert.equal(copy.state, 'Needs Review');
});

import { flagDocumentDuplicates, fingerprintDocument } from '../src/lib/documentDuplicates.js';
import {
  assessOwnershipDocument,
  inspectDocumentHorseIdentity,
  ownershipReviewBlockers,
  ownershipDocumentReviewKey,
} from '../src/lib/ownershipDocumentReview.js';
import { computeOwnershipConfidence } from '../src/store/xbarStoreLogic.js';
import type { DocumentRecord, OwnershipRecord, OwnershipProofRequirement } from '../src/types/xbar.js';
function document(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: 'doc-original',
    title: 'Registration',
    type: 'Registration',
    horseId: horse.id,
    uploadedBy: 'Tester',
    uploadedAt: '2026-10-01',
    source: 'Bulk Intake',
    state: 'Ready',
    confidence: 0.91,
    summary: 'Synthetic source',
    duplicateRisk: 'Low',
    extractedTextPreview: paper,
    entities: { horseName: horse.name, registrationNumber: horse.registrationNumber },
    localFileKey: 'local-original',
    ...overrides,
  };
}
test('batch duplicate detection flags renamed bytes within batch but retains every file', async () => {
  const contentSha256 = await fingerprintDocument(new Blob([paper]));
  const result = flagDocumentDuplicates(
    [document({ contentSha256 }), document({ id: 'copy', title: 'Renamed', contentSha256 })],
    [],
  );
  assert.equal(result.length, 2);
  assert.equal(result[0].duplicateRisk, 'Low');
  assert.equal(result[1].duplicateRisk, 'Possible Duplicate');
  assert.equal(result[1].duplicateOfId, 'doc-original');
  assert.equal(result[1].state, 'Needs Review');
});
test('same filename different bytes is tentative; changed dated text and name is not a duplicate', async () => {
  const first = document({ contentSha256: await fingerprintDocument(new Blob(['first'])) });
  const second = document({
    id: 'second',
    contentSha256: await fingerprintDocument(new Blob(['second'])),
    extractedTextPreview: 'A revised agreement',
  });
  const flagged = flagDocumentDuplicates([second], [first])[0];
  assert.match(flagged.duplicateReason ?? '', /Same filename; contents may differ/);
  assert.equal(flagDocumentDuplicates([{ ...second, title: 'Revised agreement' }], [first])[0].duplicateRisk, 'Low');
});
test('semantic duplicate warning needs substantial matching text, not merely same horse/type', () => {
  const first = document();
  assert.match(
    flagDocumentDuplicates([document({ id: 'copy', title: 'Rescan' })], [first])[0].duplicateReason ?? '',
    /Matching extracted text/,
  );
  const next = document({ id: 'different', title: 'Renewal', extractedTextPreview: `${paper}\nIssued: 2026-10-02` });
  assert.equal(flagDocumentDuplicates([next], [first])[0].duplicateRisk, 'Low');
});
test('ownership support checks contents, not the upload filename or selected horse alone', () => {
  const rows: Array<[Partial<DocumentRecord>, string]> = [
    [{ type: 'Vet Record' }, 'wrong_type'],
    [{ extractedTextPreview: 'This is a grocery receipt that someone renamed registration.pdf' }, 'wrong_type'],
    [{ state: 'Archived' }, 'missing'],
    [{ localFileKey: undefined }, 'missing'],
    [{ extractedTextPreview: '' }, 'unreadable'],
    [
      { entities: {}, extractedTextPreview: 'CERTIFICATE OF REGISTRATION. Horse identity is not readable.' },
      'missing_identity',
    ],
    [
      { extractedTextPreview: 'VACCINATION RECORD\nRegistered Name: DESERT DAISY\nRegistration Number: 7001111' },
      'wrong_type',
    ],
    [
      { extractedTextPreview: 'CERTIFICATE OF REGISTRATION\nRegistered Name: RED MOON\nRegistration Number: 1234567' },
      'identity_mismatch',
    ],
    [{ horseId: 'horse-b' }, 'identity_mismatch'],
    [{ entities: { horseName: horse.name, registrationNumber: '9999999' } }, 'identity_mismatch'],
    [{ identityReviewRequired: true }, 'identity_mismatch'],
    [{ state: 'Matched' }, 'review_needed'],
    [{ processingNote: 'Only 3 of 10 pages were read.' }, 'review_needed'],
    [{ duplicateRisk: 'Possible Duplicate' }, 'review_needed'],
  ];
  for (const [patch, status] of rows) {
    const result = assessOwnershipDocument(document(patch), horse, 'registration_certificate');
    assert.equal(result.ok, false, JSON.stringify(patch));
    assert.equal(result.status, status, JSON.stringify(patch));
  }
  assert.equal(assessOwnershipDocument(document(), horse, 'registration_certificate').ok, true);
  assert.equal(assessOwnershipDocument(document(), horse, 'bill_of_sale').ok, false);
});
test('upload/link/OCR and legacy verified flag cannot create a human review attestation', () => {
  const linked: OwnershipProofRequirement = {
    id: 'proof',
    kind: 'registration_certificate',
    label: 'Registration',
    status: 'linked',
    documentId: 'doc-original',
  };
  assert.equal(computeOwnershipConfidence([linked]), 0);
  assert.equal(computeOwnershipConfidence([{ ...linked, status: 'verified' }]), 0);
  const reviewed = {
    ...linked,
    status: 'verified' as const,
    verifiedBy: 'Tester',
    verifiedAt: '2026-10-02',
    reviewAttestedAt: '2026-10-02',
    reviewedSourceKey: ownershipDocumentReviewKey(document()),
  };
  assert.equal(computeOwnershipConfidence([reviewed]), 100);
  const record = { proofRequirements: [reviewed] } as OwnershipRecord;
  assert.deepEqual(ownershipReviewBlockers(record, horse, [document()]), []);
  assert.match(
    ownershipReviewBlockers(record, horse, [document({ extractedTextPreview: `${paper}\nRevised source` })])[0],
    /Human source review/,
  );
  assert.match(ownershipReviewBlockers(record, horse, [document({ state: 'Archived' })])[0], /missing or archived/);
});

test('camera filenames derive ownership type from explicit readable source headings', async () => {
  for (const [heading, type, kind] of [
    ['BILL OF SALE', 'Bill of Sale', 'bill_of_sale'],
    ['TRANSFER OF OWNERSHIP', 'Transfer Packet', 'transfer_form'],
  ] as const) {
    const source = `${heading}\nRegistered Name: DESERT DAISY\nRegistration Number: 7001111\nBuyer: Taylor Ranch\nSeller: Sample Seller\nSignature: signed`;
    const record = await buildDocumentRecord({
      file: new File([source], 'IMG_1234.txt', { type: 'text/plain' }),
      selectedHorse: horse,
      horses: [horse],
      existingDocuments: [],
      uploadedBy: 'Tester',
      source: 'Bulk Intake',
    });
    assert.equal(record.type, type);
    assert.equal(
      assessOwnershipDocument({ ...record, state: 'Ready', localFileKey: 'fixture-file' }, horse, kind).ok,
      true,
    );
  }
});

test('registration-only identity uses canonical registry prefix normalization', () => {
  const source = document({
    entities: { registrationNumber: '7001111', registry: 'AQHA' },
    extractedTextPreview: 'CERTIFICATE OF REGISTRATION\nRegistration Number: AQHA 7001111\nOwner: Taylor Ranch',
  });
  assert.equal(
    assessOwnershipDocument(source, { ...horse, registrationNumber: 'AQHA7001111' }, 'registration_certificate').ok,
    true,
  );
});

test('references to other papers inside an agreement do not create a mixed-document warning', async () => {
  const source =
    'BILL OF SALE\nRegistered Name: DESERT DAISY\nRegistration Number: 7001111\nSeller agrees to deliver the registration certificate to Buyer.';
  const record = await buildDocumentRecord({
    file: new File([source], 'IMG_1234.txt', { type: 'text/plain' }),
    selectedHorse: horse,
    horses: [horse],
    existingDocuments: [],
    uploadedBy: 'Tester',
    source: 'Bulk Intake',
  });
  assert.equal(record.type, 'Bill of Sale');
  assert.equal(record.processingNote, '');
  assert.equal(
    assessOwnershipDocument({ ...record, state: 'Ready', localFileKey: 'fixture' }, horse, 'bill_of_sale').ok,
    true,
  );
});

test('flattened text-layer PDFs retain their leading document heading', async () => {
  const { inferDocumentType } = await import('../src/lib/xbarRuntime.js');
  const flattened = `BILL OF SALE Registered Name: DESERT DAISY Registration Number: 7001111 Buyer: Taylor Ranch Seller: Sample Seller ${'Terms and conditions follow. '.repeat(15)}`;
  assert.equal(inferDocumentType('IMG_1234.pdf', flattened).type, 'Bill of Sale');
});

test('a reference to a registration certificate cannot turn a health paper into ownership support', async () => {
  const source =
    'HEALTH CERTIFICATE\nRegistered Name: DESERT DAISY\nRegistration Number: 7001111\nVaccinations administered today.\nInstructions: Bring your registration certificate for transport.';
  const record = await buildDocumentRecord({
    file: new File([source], 'registration.txt', { type: 'text/plain' }),
    selectedHorse: horse,
    horses: [horse],
    existingDocuments: [],
    uploadedBy: 'Tester',
    source: 'Bulk Intake',
  });
  assert.equal(record.type, 'Vet Record');
  assert.equal(
    assessOwnershipDocument({ ...record, state: 'Ready', localFileKey: 'fixture' }, horse, 'registration_certificate')
      .ok,
    false,
  );
  assert.equal(
    assessOwnershipDocument(
      { ...record, type: 'Registration', state: 'Ready', localFileKey: 'fixture' },
      horse,
      'registration_certificate',
    ).ok,
    false,
    'Legacy filename-derived types also fail closed',
  );
});

test('ownership source rejects contradictory pedigree and microchip, preserving equivalent parent IDs', () => {
  const identifiedHorse = {
    ...horse,
    bloodline: { sire: 'RIGHT PARENT (AQHA 1234567)', dam: 'HOLLYWOOD GOLD', family: '' },
    microchipId: '900123456789012',
  };
  for (const fact of [
    'Sire: WRONG PARENT',
    'Sire: RIGHT PARENT 7654321',
    'Dam: ANOTHER MARE',
    'Microchip: 900123456789099',
  ]) {
    const result = assessOwnershipDocument(
      document({ extractedTextPreview: `${paper}\n${fact}` }),
      identifiedHorse,
      'registration_certificate',
    );
    assert.equal(result.ok, false, fact);
    assert.equal(result.status, 'identity_mismatch', fact);
  }
  assert.equal(
    assessOwnershipDocument(
      document({
        extractedTextPreview: `${paper}\nSire: RIGHT PARENT 1234567\nDam: HOLLYWOOD GOLD\nMicrochip: 900123456789012`,
      }),
      identifiedHorse,
      'registration_certificate',
    ).ok,
    true,
  );
  assert.equal(
    assessOwnershipDocument(
      document({ extractedTextPreview: `${paper}\nSire: WRONG PARENT`.replace('Registration Number: 7001111\n', '') }),
      identifiedHorse,
      'registration_certificate',
    ).ok,
    false,
    'A same-name match cannot override a conflicting parent',
  );
});

test('a signature field inside a flattened ownership agreement remains eligible for human review', () => {
  const source =
    'BILL OF SALE Registered Name: DESERT DAISY Registration Number: 7001111 Buyer: Taylor Ranch Seller: Original Ranch Signature: signed';
  assert.equal(
    assessOwnershipDocument(document({ type: 'Bill of Sale', extractedTextPreview: source }), horse, 'signature_page')
      .ok,
    true,
  );
  assert.equal(
    assessOwnershipDocument(
      document({ type: 'Bill of Sale', extractedTextPreview: source.replace('BILL OF SALE', 'GROCERY RECEIPT') }),
      horse,
      'signature_page',
    ).ok,
    false,
  );
});

test('legacy filename-derived types cannot override contradictory source purposes', () => {
  const legacy = document({
    extractedTextPreview:
      'HEALTH CERTIFICATE\nRegistered Name: DESERT DAISY\nRegistration Number: 7001111\nRegistration certificate inspected: yes\nVaccinations administered today.',
  });
  const result = assessOwnershipDocument(legacy, horse, 'registration_certificate');
  assert.equal(result.ok, false);
  assert.equal(result.status, 'wrong_type');
});

test('microchip prose and empty-value placeholders are not conflicting identifiers', () => {
  const target = { ...horse, microchipId: '900123456789012' };
  for (const note of [
    'Microchip: UNKNOWN',
    'Microchip scanned',
    'Microchip: pending',
    'Microchip: not recorded',
    'Microchip number: unavailable',
    'Microchip ID: N/A',
    'Microchip: none',
    'Microchip scan completed',
    'Microchip: 900123456789012_EXTRA',
    'Microchip: 9001234567890123',
    'Microchip: 900123456789012X',
    'Microchip: 900123456 789012X',
    'Microchip: 900123456 789012_EXTRA',
    'Microchip: 9001234567890123456789012345678901',
  ]) {
    const source = document({ extractedTextPreview: `${paper}\n${note}` });
    assert.equal(inspectDocumentHorseIdentity(source, target).conflictReason, undefined, note);
    assert.equal(assessOwnershipDocument(source, target, 'registration_certificate').ok, true, note);
  }
});

test('complete numeric and legacy hexadecimal microchips retain matching and conflict checks', () => {
  for (const [stored, matching, different] of [
    ['900123456789012', 'Microchip: 900123456789012', 'Microchip: 900123456789099'],
    ['900123456789012', 'Microchip Number: 900-123-456-789-012', 'Microchip No. 900-123-456-789-099'],
    ['123456789', 'Microchip ID # 123456789', 'Microchip ID # 987654321'],
    ['123456789', 'Microchip: AVID*123*456*789', 'Microchip: AVID*987*654*321'],
    ['123456789', 'Microchip: 123*456*789', 'Microchip: 987*654*321'],
    ['900123456789012', 'Microchip: 900.123456789012', 'Microchip: 900.123456789099'],
    ['900123456789012', 'Microchip: 900123456 789012', 'Microchip: 900123456 789099'],
    ['900123456789012', 'Microchip: 900123456\n789012', 'Microchip: 900123456\n789099'],
    ['900123456789012', 'Microchip: 900 123 456 789 012', 'Microchip: 900 123 456 789 099'],
    ['0A01183726', 'Microchip: 0A 0118 3726', 'Microchip: 0A 0118 3727'],
    ['A123456789', 'Microchip: A123456789', 'Microchip: A987654321'],
    ['0A01183726', 'Microchip: 0a01183726', 'Microchip: 0A01183727'],
    ['ABCDEFABCD', 'Microchip: abcdefabcd', 'Microchip: ABCDEFABCE'],
    ['0900123456789012', 'Microchip: 0900123456789012', 'Microchip: 0900123456789099'],
    ['900123456789012', 'Microchip: 0900123456789012', 'Microchip: 0900123456789099'],
  ]) {
    const target = { ...horse, microchipId: stored };
    assert.equal(
      inspectDocumentHorseIdentity(document({ extractedTextPreview: `${paper}\n${matching}` }), target).conflictReason,
      undefined,
      matching,
    );
    assert.match(
      inspectDocumentHorseIdentity(document({ extractedTextPreview: `${paper}\n${different}` }), target)
        .conflictReason ?? '',
      /microchip conflicts/,
      different,
    );
  }
  const repeated = document({
    extractedTextPreview: `${paper}\nMicrochip: UNKNOWN\nMicrochip: 900123456789012\nMicrochip: 900123456789099`,
  });
  assert.match(inspectDocumentHorseIdentity(repeated, horse).conflictReason ?? '', /microchip conflicts/);
});

test('complete conflicting microchips remain visible before unrelated numeric text', () => {
  const target = { ...horse, microchipId: '900123456789012' };
  for (const note of [
    'Microchip: 900123456789099\n2026 vaccine record',
    'Microchip: 900123456789099\n2026-01-01 vaccination',
    'Microchip: 900123456789099\nA vaccine',
    'Microchip: 900123456789099\nX123 vaccine batch',
    'Microchip: 900123456789099 2026 vaccine record',
    'Microchip: 900 123 456 789 099\n2026 vaccine record',
  ]) {
    assert.match(
      inspectDocumentHorseIdentity(document({ extractedTextPreview: `${paper}\n${note}` }), target).conflictReason ??
        '',
      /microchip conflicts/,
      note,
    );
  }
});

test('recognized chip formats keep matching and conflicts before unrelated prose', () => {
  for (const [stored, matching, different] of [
    ['123456789', '123456789', '987654321'],
    ['123456789', '123 456 789', '987 654 321'],
    ['123456789', 'AVID*123*456*789', 'AVID*987*654*321'],
    ['900123456789012', '900123456789012', '900123456789099'],
    ['900123456789012', '900 123 456 789 012', '900 123 456 789 099'],
    ['0A01183726', '0A 0118 3726', '0A 0118 3727'],
    ['ABCDEFABCD', 'ABCDEFABCD', 'ABCDEFABCE'],
  ]) {
    const target = { ...horse, microchipId: stored };
    for (const suffix of [
      '\nA vaccine',
      '\nX123 vaccine batch',
      ' A vaccine',
      ' X123 vaccine batch',
      '\n2026-01-01 vaccination',
    ]) {
      assert.equal(
        inspectDocumentHorseIdentity(
          document({ extractedTextPreview: `${paper}\nMicrochip: ${matching}${suffix}` }),
          target,
        ).conflictReason,
        undefined,
        `${matching}${suffix}`,
      );
      assert.match(
        inspectDocumentHorseIdentity(
          document({ extractedTextPreview: `${paper}\nMicrochip: ${different}${suffix}` }),
          target,
        ).conflictReason ?? '',
        /microchip conflicts/,
        `${different}${suffix}`,
      );
    }
  }
});
