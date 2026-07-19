import assert from 'node:assert/strict';
import test from 'node:test';
import { extractRegistrationFields } from '../src/lib/registrationExtraction.js';

// OCR flattens a certificate into one noisy line; these fixtures mirror that.

test('extracts every field from a flattened AQHA certificate', () => {
  const text =
    'AMERICAN QUARTER HORSE ASSOCIATION CERTIFICATE OF REGISTRATION ' +
    'Registered Name: SMART LITTLE PEPTO Registration Number: 5551234 ' +
    'Foaled: 03/15/2019 Sex: Stallion Color: Sorrel ' +
    'Sire: PEPTOBOONSMAL AQHA 3123456 Dam: SMART LITTLE KITTY AQHA 3987654 ' +
    'Breeder: JOHN DOE Owner: JANE SMITH';

  const fields = extractRegistrationFields(text);
  assert.equal(fields.horseName, 'SMART LITTLE PEPTO');
  assert.equal(fields.registrationNumber, '5551234');
  assert.equal(fields.registry, 'AQHA');
  assert.equal(fields.sex, 'Stud');
  assert.equal(fields.color, 'Sorrel');
  assert.equal(fields.foaledOn, '2019-03-15');
  assert.equal(fields.sire, 'PEPTOBOONSMAL');
  assert.equal(fields.sireRegistration, '3123456');
  assert.equal(fields.dam, 'SMART LITTLE KITTY');
  assert.equal(fields.damRegistration, '3987654');
  assert.equal(fields.ownerName, 'JANE SMITH');
});

test('handles lowercase labels, abbreviated reg numbers, and a gelding', () => {
  const text =
    'certificate of registration name of horse: DOCS BLUE VALENTINE ' +
    'reg no. APHA 0456789 sex: gelding color: blue roan foaled 5/2/2020 ' +
    'sire DOC BAR reg no 0011223 dam BLUE VALENTINE reg no 0044556 owner: RED CANYON RANCH';

  const fields = extractRegistrationFields(text);
  assert.equal(fields.horseName, 'DOCS BLUE VALENTINE');
  assert.equal(fields.registrationNumber, '0456789');
  assert.equal(fields.registry, 'APHA');
  assert.equal(fields.sex, 'Gelding');
  assert.equal(fields.color, 'Blue Roan');
  assert.equal(fields.foaledOn, '2020-05-02');
  assert.equal(fields.sire, 'DOC BAR');
  assert.equal(fields.sireRegistration, '0011223');
  assert.equal(fields.dam, 'BLUE VALENTINE');
  assert.equal(fields.damRegistration, '0044556');
});

test('the horse registration number is never confused with a parent reg number', () => {
  const text =
    'Registration Number: 7778889 Name: FANCY FILLY Sex: Filly Color: Palomino ' +
    'Sire: BIG DADDY AQHA 1112223 Dam: PRETTY MARE AQHA 4445556';
  const fields = extractRegistrationFields(text);
  assert.equal(fields.registrationNumber, '7778889');
  assert.equal(fields.sex, 'Filly');
  assert.equal(fields.color, 'Palomino');
  assert.equal(fields.sireRegistration, '1112223');
  assert.equal(fields.damRegistration, '4445556');
  assert.notEqual(fields.registrationNumber, fields.sireRegistration);
  assert.notEqual(fields.registrationNumber, fields.damRegistration);
});

test('returns an empty object when the text carries no registration data', () => {
  assert.deepEqual(extractRegistrationFields('random invoice text with no horse fields'), {});
  assert.deepEqual(extractRegistrationFields(''), {});
});

test('detects sex and color even without explicit labels', () => {
  const text = 'This bay mare is offered for sale. Registration Number: 9990001';
  const fields = extractRegistrationFields(text);
  assert.equal(fields.sex, 'Mare');
  assert.equal(fields.color, 'Bay');
  assert.equal(fields.registrationNumber, '9990001');
});
