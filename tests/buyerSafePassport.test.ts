import assert from 'node:assert/strict';
import test from 'node:test';
import { PUBLIC_PASSPORT_KEYS, toPublicPassport } from '../src/lib/buyerSafePassport.js';
import type { HorseRecord } from '../src/types/xbar.js';

// A record populated with distinctive PRIVATE sentinel values. None of these may
// appear in the buyer-safe passport.
function loadedHorse(overrides: Partial<HorseRecord> = {}): HorseRecord {
  return {
    id: 'horse-9',
    name: 'Smart Little Pepto',
    breed: 'Quarter Horse',
    sex: 'Mare',
    color: 'Sorrel',
    markings: 'Star and snip',
    foaledOn: '2019-04-02',
    age: 6,
    registered: true,
    registry: 'AQHA',
    registrationNumber: 'AQHA-55512',
    aqhaNumber: '',
    bloodline: { sire: 'Peptoboonsmal', dam: 'Smart Little Lena', family: '' },
    profileImage: 'https://cdn.test/horse-hero.jpg',
    gallery: [
      { id: 'g1', label: 'Hero', kind: 'Hero', url: 'https://cdn.test/horse-hero.jpg', status: 'Approved' },
      { id: 'g2', label: 'Papers', kind: 'Document Cover', url: 'https://cdn.test/papers.jpg', status: 'Approved' },
    ],
    // ---- everything below is PRIVATE and must never leak ----
    owner: 'SECRET_OWNER_NAME',
    ownerEntity: 'SECRET_OWNER_LLC',
    microchipId: 'CHIP_SECRET_985141',
    costBasis: 987654,
    insuredValue: 555111,
    medicalNotes: 'SECRET_MEDICAL_NOTE',
    lastVetVisit: '2025-11-01',
    ownership: [{ id: 'o1', name: 'SECRET_STAKEHOLDER', role: 'Legal Owner', share: 100 }],
    sale: { askPrice: 424242, inquiryCount: 3, watchlistCount: 9, buyerConfidence: 77 },
    readiness: { score: 91, packetStatus: 'Ready', blockers: ['SECRET_BLOCKER'] },
    location: { ranch: 'Home', barn: 'SECRET_BARN', pasture: 'SECRET_PASTURE', stall: '7' },
    notes: [{ id: 'n1', body: 'SECRET_NOTE', author: 'x', createdAt: '' }],
    documentFacts: [{ id: 'd1', label: 'SECRET_DOC_LABEL', value: 'SECRET_DOC_VALUE' }],
    medicalTimeline: [{ id: 'm1', title: 'SECRET_MED_EVENT', summary: 's', date: '' }],
    activity: [{ id: 'a1', title: 'SECRET_ACTIVITY', summary: 's', date: '' }],
    ...overrides,
  } as unknown as HorseRecord;
}

const PRIVATE_SENTINELS = [
  'SECRET_OWNER_NAME',
  'SECRET_OWNER_LLC',
  'CHIP_SECRET_985141',
  '987654',
  '555111',
  'SECRET_MEDICAL_NOTE',
  'SECRET_STAKEHOLDER',
  '424242',
  'SECRET_BLOCKER',
  'SECRET_BARN',
  'SECRET_PASTURE',
  'SECRET_NOTE',
  'SECRET_DOC_LABEL',
  'SECRET_DOC_VALUE',
  'SECRET_MED_EVENT',
  'SECRET_ACTIVITY',
  '2025-11-01', // lastVetVisit
];

test('buyer-safe passport exposes exactly the allowlisted keys, nothing more', () => {
  const dto = toPublicPassport(loadedHorse());
  assert.deepEqual(Object.keys(dto).sort(), [...PUBLIC_PASSPORT_KEYS].sort());
});

test('no private field value leaks into the serialized passport', () => {
  const serialized = JSON.stringify(toPublicPassport(loadedHorse()));
  for (const secret of PRIVATE_SENTINELS) {
    assert.ok(!serialized.includes(secret), `leaked private value: ${secret}`);
  }
});

test('safe identity fields are present and correct', () => {
  const dto = toPublicPassport(loadedHorse());
  assert.equal(dto.name, 'Smart Little Pepto');
  assert.equal(dto.breed, 'Quarter Horse');
  assert.equal(dto.sire, 'Peptoboonsmal');
  assert.equal(dto.dam, 'Smart Little Lena');
  assert.equal(dto.registry, 'AQHA');
  assert.equal(dto.registrationNumber, 'AQHA-55512');
  assert.match(dto.passportId, /^XB-/);
});

test('registration details are withheld when the horse is not registered', () => {
  const dto = toPublicPassport(loadedHorse({ registered: false }));
  assert.equal(dto.registered, false);
  assert.equal(dto.registry, '');
  assert.equal(dto.registrationNumber, '');
});

test('photo is a real horse photo, never a document scan', () => {
  // profileImage matches a real Hero gallery asset -> exposed.
  assert.equal(toPublicPassport(loadedHorse()).photoUrl, 'https://cdn.test/horse-hero.jpg');

  // Only a document-cover asset exists and profileImage points at it -> withheld.
  const docOnly = toPublicPassport(
    loadedHorse({
      profileImage: 'https://cdn.test/papers.jpg',
      gallery: [
        { id: 'g2', label: 'Papers', kind: 'Document Cover', url: 'https://cdn.test/papers.jpg', status: 'Approved' },
      ] as HorseRecord['gallery'],
    }),
  );
  assert.equal(docOnly.photoUrl, '');
});
