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

/*
 * Two ways a paper produced a wrong NAME rather than no name.
 *
 * Both are the "silent success" shape: the extractor returned something
 * plausible where it should have returned nothing or cleaned what it had, and
 * the wrong value went on to label ownership records and sale material.
 */

test('separator junk from a ruled or tabled scan is stripped from the name', () => {
  // Only the trailing end was cleaned, so a table pipe or a ruled line read as
  // underscores stayed welded to the front of the name. These are worse than a
  // missing name: they carry letters, so the number-named-horse repair pass
  // does not flag them and nobody is ever asked about them.
  const cases: [string, string][] = [
    ['Registered Name | BERRY PEACHY CHIC Reg No 539882319930', 'BERRY PEACHY CHIC'],
    ['Registered Name | BERRY PEACHY CHIC | Reg No 539882319930', 'BERRY PEACHY CHIC'],
    ['Registered Name ___ BLUE VALENTINE DOT COM', 'BLUE VALENTINE DOT COM'],
    ['Registered Name .... BONNY LIL MAN ROGERS', 'BONNY LIL MAN ROGERS'],
    ['Registered Name :: SMART LITTLE LENA', 'SMART LITTLE LENA'],
    ['Registered Name === HOLLYWOOD DUN IT', 'HOLLYWOOD DUN IT'],
  ];

  for (const [text, expected] of cases) {
    assert.equal(extractRegistrationFields(text).horseName, expected, text);
  }
});

test('a parent name is cleaned the same way', () => {
  const fields = extractRegistrationFields('Sire | SHINING SPARK 3344556 Dam ___ MISS KITTY 7788990');
  assert.equal(fields.sire, 'SHINING SPARK');
  assert.equal(fields.dam, 'MISS KITTY');
});

test('"Name of Owner" never becomes the horse name', () => {
  /*
   * The old guard tested the value against /^(?:of\s+)?(?:sire|dam|owner)/,
   * which cannot fire here: `owner` is itself a stop label, so the value is
   * truncated to a bare "of" before that word is reached. The paper named the
   * horse "of".
   */
  assert.equal(extractRegistrationFields('Name of Owner ERIN WYRICK Registration Number 5551234').horseName, undefined);
  assert.equal(extractRegistrationFields('Name of Sire SHINING SPARK').horseName, undefined);
  assert.equal(extractRegistrationFields('Name of Dam MISS KITTY').horseName, undefined);
});

test('a real name that merely starts with a filler word survives', () => {
  // Label context selects horse data; words and articles inside it are kept.
  assert.equal(extractRegistrationFields('Registered Name THE ONE').horseName, 'THE ONE');
  assert.equal(extractRegistrationFields('Registered Name A SHINER NAMED SIOUX').horseName, 'A SHINER NAMED SIOUX');
});

test('a labelled name still reads out of flattened OCR text', () => {
  // Checked because the opposite was claimed: flattening a scan onto one line
  // does NOT break label adjacency, and the recovery-from-filename path is a
  // safety net rather than a substitute for this.
  const flattened =
    'AMERICAN QUARTER HORSE ASSOCIATION CERTIFICATE OF REGISTRATION ' +
    'Registered Name BAR B JOSEYWOOD Registration Number 5551234 ' +
    'Foaled April 12 2019 Sex Mare Color Sorrel Sire SHINING SPARK 3344556 Dam MISS KITTY 7788990';
  const fields = extractRegistrationFields(flattened);
  assert.equal(fields.horseName, 'BAR B JOSEYWOOD');
  assert.equal(fields.registrationNumber, '5551234');
  assert.equal(fields.sire, 'SHINING SPARK');
  assert.equal(fields.dam, 'MISS KITTY');
});

test('punctuation belonging to a value survives field separator cleanup', () => {
  const fields = extractRegistrationFields(
    'Registered Name | *RAFFLES Registration Number 1234567 ' +
      'Sire: *BASK 2345678 Dam: "MISS KITTY" 3456789 Owner: *STAR RANCH',
  );
  assert.equal(fields.horseName, '*RAFFLES');
  assert.equal(fields.sire, '*BASK');
  assert.equal(fields.sireRegistration, '2345678');
  assert.equal(fields.dam, '"MISS KITTY"');
  assert.equal(fields.ownerName, '*STAR RANCH');
  assert.equal(extractRegistrationFields('Registered Name -STAR').horseName, '-STAR');
  assert.equal(extractRegistrationFields('Registered Name .STAR').horseName, '.STAR');
});

test('specific horse-name labels accept names without a word blacklist', () => {
  for (const label of ['Registered Name', 'Horse Name', 'Name of Horse']) {
    for (const name of ['THE', 'OF', 'THIS AND THAT', 'OWNER OF THE RANCH']) {
      assert.equal(extractRegistrationFields(`${label}: ${name} Registration Number 1234567`).horseName, name);
    }
  }
});

test('qualified owner and parent labels do not hide a later horse name', () => {
  assert.equal(
    extractRegistrationFields('Name of Owner: ERIN WYRICK Registered Name: THE Registration Number 1234567').horseName,
    'THE',
  );
  assert.equal(extractRegistrationFields('Owner Name: ERIN WYRICK Registration Number 1234567').horseName, undefined);
  assert.equal(
    extractRegistrationFields('Name of Breeder: ERIN WYRICK Registration Number 1234567').horseName,
    undefined,
  );
  assert.equal(extractRegistrationFields('Name: THE Registration Number 1234567').horseName, 'THE');
});
