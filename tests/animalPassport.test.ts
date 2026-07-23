import assert from 'node:assert/strict';
import test from 'node:test';
import { animalPassportId, hasHorsePhoto, identityCompleteness, isHorsePhotoAsset } from '../src/lib/animalPassport.js';
import type { HorseRecord } from '../src/types/xbar.js';

test('passport id is deterministic for the same horse id', () => {
  assert.equal(animalPassportId('horse-abc123'), animalPassportId('horse-abc123'));
});

test('passport id matches the XB-XXXX-XXXX shape with unambiguous alphabet', () => {
  const id = animalPassportId('horse-abc123');
  assert.match(id, /^XB-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  // Crockford excludes I, L, O, U to stay legible when written on a stall card.
  assert.ok(!/[ILOU]/.test(id.replace('XB-', '')));
});

test('different horse ids produce different passport ids', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i += 1) {
    seen.add(animalPassportId(`horse-${i}`));
  }
  // No collisions across a realistic workspace size.
  assert.equal(seen.size, 500);
});

test('empty or missing id yields a stable placeholder, never a crash', () => {
  assert.equal(animalPassportId(''), 'XB-0000-0000');
  assert.equal(animalPassportId(undefined), 'XB-0000-0000');
  assert.equal(animalPassportId(null), 'XB-0000-0000');
});

function horse(overrides: Partial<HorseRecord>): HorseRecord {
  return { id: 'horse-1', name: '', ...overrides } as HorseRecord;
}

test('identity completeness counts only real, filled fields', () => {
  const empty = identityCompleteness(horse({}));
  assert.equal(empty.present, 0);
  assert.equal(empty.total, 11);
  assert.equal(empty.percent, 0);
  assert.ok(empty.missing.includes('Name'));
});

test('a fully described horse reaches 100 percent', () => {
  const full = identityCompleteness(
    horse({
      name: 'Smart Little Pepto',
      breed: 'Quarter Horse',
      sex: 'Mare',
      foaledOn: '2019-04-02',
      color: 'Sorrel',
      markings: 'Star',
      registered: true,
      registrationNumber: 'AQHA-55512',
      aqhaNumber: '',
      bloodline: { sire: 'Peptoboonsmal', dam: 'Smart Little Lena' },
      microchipId: '985141000123456',
      owner: 'Erin Wyrick',
      profileImage: 'https://example.test/horse.jpg',
    } as Partial<HorseRecord>),
  );
  assert.equal(full.present, 11);
  assert.equal(full.percent, 100);
  assert.deepEqual(full.missing, []);
});

test('registration needs both the flag and a number to count', () => {
  const flaggedButBlank = identityCompleteness(horse({ registered: true, registrationNumber: '', aqhaNumber: '' }));
  assert.ok(flaggedButBlank.missing.includes('Registration'));
  const complete = identityCompleteness(horse({ registered: true, registrationNumber: 'AQHA-1' }));
  assert.ok(!complete.missing.includes('Registration'));
});

test('age alone satisfies the foaled field', () => {
  const byAge = identityCompleteness(horse({ age: 6 }));
  assert.ok(!byAge.missing.includes('Foaled date'));
});

test('only an actual horse photo satisfies the Photo field', () => {
  const photo = { id: 'g1', label: 'Hero', kind: 'Hero', url: 'https://x.test/h.jpg', status: 'Approved' };
  const withPhoto = identityCompleteness(horse({ gallery: [photo] as HorseRecord['gallery'] }));
  assert.ok(!withPhoto.missing.includes('Photo'));

  // A pedigree scan or document cover is imagery, not a photo of the horse.
  const docOnly = {
    id: 'g2',
    label: 'Papers',
    kind: 'Document Cover',
    url: 'https://x.test/d.jpg',
    status: 'Approved',
  };
  const withoutPhoto = identityCompleteness(horse({ gallery: [docOnly] as HorseRecord['gallery'] }));
  assert.ok(withoutPhoto.missing.includes('Photo'));

  // A photo kind with no usable URL does not count either.
  const noUrl = { id: 'g3', label: 'Hero', kind: 'Hero', url: '', status: 'Draft' };
  const blankUrl = identityCompleteness(horse({ gallery: [noUrl] as HorseRecord['gallery'] }));
  assert.ok(blankUrl.missing.includes('Photo'));
});

test('hasHorsePhoto: profile image or real photo kind counts, docs do not', () => {
  assert.equal(hasHorsePhoto(horse({ profileImage: 'https://x.test/h.jpg' })), true);
  assert.equal(
    hasHorsePhoto(
      horse({
        gallery: [{ id: 'g', label: '', kind: 'Conformation', url: 'u', status: 'Approved' }] as HorseRecord['gallery'],
      }),
    ),
    true,
  );
  assert.equal(
    hasHorsePhoto(
      horse({
        gallery: [{ id: 'g', label: '', kind: 'Pedigree', url: 'u', status: 'Approved' }] as HorseRecord['gallery'],
      }),
    ),
    false,
  );
  assert.equal(hasHorsePhoto(horse({})), false);
});

test('isHorsePhotoAsset: only real photo kinds with a URL qualify', () => {
  assert.equal(isHorsePhotoAsset({ kind: 'Hero', url: 'u' }), true);
  assert.equal(isHorsePhotoAsset({ kind: 'Conformation', url: 'u' }), true);
  assert.equal(isHorsePhotoAsset({ kind: 'Sale Still', url: 'u' }), true);
  assert.equal(isHorsePhotoAsset({ kind: 'Pedigree', url: 'u' }), false);
  assert.equal(isHorsePhotoAsset({ kind: 'Document Cover', url: 'u' }), false);
  assert.equal(isHorsePhotoAsset({ kind: 'Hero', url: '' }), false);
});

test('percent is rounded, not truncated', () => {
  // 1 of 11 present = 9.09% -> 9
  const one = identityCompleteness(horse({ name: 'X' }));
  assert.equal(one.percent, 9);
});
