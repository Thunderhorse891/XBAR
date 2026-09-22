import assert from 'node:assert/strict';
import test from 'node:test';
import { extractRegistrationFields } from '../src/lib/registrationExtraction.js';

/*
 * The whole contract for horse-name extraction, in one table.
 *
 * Written after four rounds of review on this file in ninety minutes, in which
 * every fix was verified against the cases just raised and silently broke a
 * different one. Twice that reached production. The cause was not carelessness
 * by any one reviewer -- it was that nobody held the WHOLE behaviour, so each
 * round could only measure the part it was looking at.
 *
 * Every row below was raised by someone as a real defect. `expected` is what a
 * person reading the paper would say, not what the code currently does. A
 * change to this extractor is finished when every row passes, not when the row
 * that prompted it passes.
 *
 * Add a row when a new case is found. Never relax one to make a change pass.
 */

type ExtractionCase = {
  id: string;
  text: string;
  name?: string;
  reg?: string;
  sire?: string;
  dam?: string;
};

const CORPUS: ExtractionCase[] = [
  // --- original #222 defects (separator junk) ---
  { id: 'pipe-lead', text: 'Registered Name | BERRY PEACHY CHIC Reg No 539882319930', name: 'BERRY PEACHY CHIC' },
  { id: 'rule-underscore', text: 'Registered Name ___ BLUE VALENTINE DOT COM', name: 'BLUE VALENTINE DOT COM' },
  { id: 'leader-dots', text: 'Registered Name .... BONNY LIL MAN ROGERS', name: 'BONNY LIL MAN ROGERS' },
  { id: 'equals-rule', text: 'Registered Name === HOLLYWOOD DUN IT', name: 'HOLLYWOOD DUN IT' },
  {
    id: 'parent-junk',
    text: 'Sire | SHINING SPARK 3344556 Dam ___ MISS KITTY 7788990',
    sire: 'SHINING SPARK',
    dam: 'MISS KITTY',
  },
  // --- owner/parent false positives ---
  { id: 'name-of-owner', text: 'Name of Owner ERIN WYRICK Registration Number 5551234', name: undefined },
  { id: 'name-of-sire', text: 'Name of Sire SHINING SPARK', name: undefined },
  {
    id: 'name-of-current-owner',
    text: 'Name of Current Owner: ERIN WYRICK Registration Number 5551234',
    name: undefined,
  },
  // --- meaningful punctuation (Arabian imports) ---
  { id: 'asterisk-name', text: 'Registered Name *RAFFLES Registration Number 1234567', name: '*RAFFLES' },
  { id: 'asterisk-sire', text: 'Sire *BASK 1234567 Dam GAZAL', sire: '*BASK' },
  // --- explicit label trusted ---
  { id: 'explicit-filler', text: 'Registered Name THE Registration Number 1234567', name: 'THE' },
  { id: 'dam-in-name', text: 'Registered Name DAM OF KINGS', name: 'DAM OF KINGS' },
  { id: 'sire-in-name', text: 'Registered Name SIRE DE MAY', name: 'SIRE DE MAY' },
  // --- regressions my bad merge shipped ---
  { id: 'bare-next-label', text: 'Registered Name: | Sex Mare Registration Number 1234567', name: undefined },
  { id: 'bare-parent-label', text: 'Sire: | Dam MISS KITTY 2222222', sire: undefined, dam: 'MISS KITTY' },
  {
    id: 'name-after-heading',
    text: 'CERTIFICATE OF REGISTRATION Name: FANCY FILLY Registration Number: 1234567',
    name: 'FANCY FILLY',
  },
  {
    id: 'name-after-aqha-heading',
    text: 'AQHA CERTIFICATE OF REGISTRATION Name: BLUE MOON Registration Number: 1234567',
    name: 'BLUE MOON',
  },
  {
    id: 'parent-name-displaces',
    text: 'Name: BLUE MOON Registration Number 1234567 Sire: SHINING SPARK Registered Name: SHINING SPARK Registration Number 3344556',
    name: 'BLUE MOON',
    reg: '1234567',
  },
  // --- qualified-name exclusions ---
  {
    id: 'association-name',
    text: 'Name of Owner: ERIN WYRICK Association Name: AQHA Registration Number 5551234',
    name: undefined,
  },
  { id: 'assoc-name-newline', text: 'Association\nName: AQHA Registration Number 1234567', name: undefined },
  { id: 'farm-name-newline', text: 'Farm\nName: Blue River Ranch Registration Number 1234567', name: undefined },
  // --- divider + name starting with a field-label word ---
  {
    id: 'divider-color-name',
    text: 'Registered Name: | COLOR BAY DREAM Registration Number 1234567',
    name: 'COLOR BAY DREAM',
  },
  { id: 'dash-color-name', text: 'Registered Name - COLOR ME BLUE Registration Number 1234567', name: 'COLOR ME BLUE' },
  {
    id: 'parent-owner-name',
    text: 'Sire - OWNER OF THE RANCH 3344556 Dam: MISS KITTY 7788990',
    sire: 'OWNER OF THE RANCH',
  },
  // --- parent-only fragment must not supply horse reg ---
  {
    id: 'parent-only-frag',
    text: 'Sire: SHINING SPARK Reg No 3344556 Dam: MISS KITTY Reg No 7788990',
    name: undefined,
    reg: undefined,
  },
  // --- flattened certificate (the happy path) ---
  {
    id: 'flattened',
    text: 'AMERICAN QUARTER HORSE ASSOCIATION CERTIFICATE OF REGISTRATION Registered Name BAR B JOSEYWOOD Registration Number 5551234 Foaled April 12 2019 Sex Mare Color Sorrel Sire SHINING SPARK 3344556 Dam MISS KITTY 7788990',
    name: 'BAR B JOSEYWOOD',
    reg: '5551234',
    sire: 'SHINING SPARK',
    dam: 'MISS KITTY',
  },
  // The horse's own registration printed AFTER the pedigree. The dam must not
  // swallow it and read as "MOM Registration Number". The number itself is left
  // to review rather than guessed onto the horse or a parent -- distinguishing
  // it from a parent's own trailing number is not reliable from the text, and a
  // wrong registration is worse than an absent one.
  {
    id: 'reg-after-pedigree',
    text: 'Registered Name: STAR\nSire: DAD\nDam: MOM\nRegistration Number 1234567',
    name: 'STAR',
    sire: 'DAD',
    dam: 'MOM',
  },
  // A stop-label word inside the name must not truncate it: "NUMBER" is part of
  // the name here, not the start of the registration field.
  {
    id: 'stop-word-in-name',
    text: 'Registered Name: LUCKY NUMBER SEVEN Registration Number 1234567',
    name: 'LUCKY NUMBER SEVEN',
    reg: '1234567',
  },
  // Registries that label the horse "Animal Name" or "Horse's Name" name it as
  // explicitly as "Registered Name"; the horse must not come out unnamed.
  {
    id: 'animal-name-label',
    text: 'Animal Name: STAR Registration Number 1234567',
    name: 'STAR',
    reg: '1234567',
  },
  {
    id: 'horses-name-label',
    text: "Horse's Name: STAR Registration Number 1234567",
    name: 'STAR',
    reg: '1234567',
  },
];

test('the extraction corpus holds, every row', () => {
  const failures: string[] = [];

  for (const row of CORPUS) {
    const fields = extractRegistrationFields(row.text);
    const actual = {
      name: fields.horseName,
      reg: fields.registrationNumber,
      sire: fields.sire,
      dam: fields.dam,
    };

    for (const key of ['name', 'reg', 'sire', 'dam'] as const) {
      if (!(key in row)) continue;
      if (actual[key] !== row[key]) {
        failures.push(`${row.id} -> ${key}: got ${JSON.stringify(actual[key])}, want ${JSON.stringify(row[key])}`);
      }
    }
  }

  // Reported together: a change that breaks five rows should say so once,
  // rather than hiding four behind the first assertion to fail.
  assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
});
