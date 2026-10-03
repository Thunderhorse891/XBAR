import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import { extractRegistrationFields, detectMultipleHorses } from '../../api/_lib/document-extraction.js';

/*
 * The server reads horse names the way a person would -- same contract as the
 * browser extractor.
 *
 * api/_lib/document-extraction.js runs in the serverless bulk-upload pipeline
 * and cannot import src/lib/registrationExtraction.ts (a Vite `@/`-aliased
 * browser module), so the name-family reader is DUPLICATED there, exactly as
 * api/_lib/permissions.js duplicates src/lib/permissions.ts. Two copies of a
 * behaviour drift silently, and here the drift is quiet by construction: a
 * misread name is written to the review queue as fact, and the only way to
 * notice is to read the roster -- the same failure mode that once created
 * twenty horses named by their registration numbers.
 *
 * This pins the server copy to the SAME corpus the browser copy is pinned to
 * (tests/registrationExtractionCorpus.test.ts). `expected` is what a person
 * reading the paper would say. The final test reads the ids out of that file
 * and fails if the two corpora ever fall out of step, so a row added on one
 * side must be added on the other -- a mechanism, not a comment.
 */

const CORPUS = [
  {
    id: 'ancestor-sire-of-sire-name',
    text: 'Registered Name: BLUE MOON\nSire: SAME PARENT Reg No: 1111111\nDam: OTHER PARENT Reg No: 2222222\nSire of Sire: GRAND PARENT Reg No: 3333333',
    name: 'BLUE MOON',
    sire: 'SAME PARENT',
    dam: 'OTHER PARENT',
    review: false,
  },
  {
    id: 'ancestor-sire-of-sire-registration',
    text: 'Registered Name: BLUE MOON\nSire: SAME PARENT Reg No: 1111111\nDam: OTHER PARENT Reg No: 2222222\nSire of Sire Registration Number: 3333333',
    name: 'BLUE MOON',
    sire: 'SAME PARENT',
    dam: 'OTHER PARENT',
    review: false,
  },
  {
    id: 'ancestor-sire-of-sire-name-prefix',
    text: 'Registered Name: BLUE MOON\nSire: SAME PARENT Reg No: 1111111\nDam: OTHER PARENT Reg No: 2222222\nName of Sire of Sire: GRAND PARENT Reg No: 3333333',
    name: 'BLUE MOON',
    sire: 'SAME PARENT',
    dam: 'OTHER PARENT',
    review: false,
  },
  {
    id: 'ancestor-sire-of-dam-name',
    text: 'Registered Name: BLUE MOON\nSire: SAME PARENT Reg No: 1111111\nDam: OTHER PARENT Reg No: 2222222\nSire of Dam: GRAND PARENT Reg No: 3333333',
    name: 'BLUE MOON',
    sire: 'SAME PARENT',
    dam: 'OTHER PARENT',
    review: false,
  },
  {
    id: 'ancestor-sire-of-dam-registration',
    text: 'Registered Name: BLUE MOON\nSire: SAME PARENT Reg No: 1111111\nDam: OTHER PARENT Reg No: 2222222\nSire of Dam Registration Number: 3333333',
    name: 'BLUE MOON',
    sire: 'SAME PARENT',
    dam: 'OTHER PARENT',
    review: false,
  },
  {
    id: 'ancestor-sire-of-dam-name-prefix',
    text: 'Registered Name: BLUE MOON\nSire: SAME PARENT Reg No: 1111111\nDam: OTHER PARENT Reg No: 2222222\nName of Sire of Dam: GRAND PARENT Reg No: 3333333',
    name: 'BLUE MOON',
    sire: 'SAME PARENT',
    dam: 'OTHER PARENT',
    review: false,
  },
  {
    id: 'ancestor-dam-of-sire-name',
    text: 'Registered Name: BLUE MOON\nSire: SAME PARENT Reg No: 1111111\nDam: OTHER PARENT Reg No: 2222222\nDam of Sire: GRAND PARENT Reg No: 3333333',
    name: 'BLUE MOON',
    sire: 'SAME PARENT',
    dam: 'OTHER PARENT',
    review: false,
  },
  {
    id: 'ancestor-dam-of-sire-registration',
    text: 'Registered Name: BLUE MOON\nSire: SAME PARENT Reg No: 1111111\nDam: OTHER PARENT Reg No: 2222222\nDam of Sire Registration Number: 3333333',
    name: 'BLUE MOON',
    sire: 'SAME PARENT',
    dam: 'OTHER PARENT',
    review: false,
  },
  {
    id: 'ancestor-dam-of-sire-name-prefix',
    text: 'Registered Name: BLUE MOON\nSire: SAME PARENT Reg No: 1111111\nDam: OTHER PARENT Reg No: 2222222\nName of Dam of Sire: GRAND PARENT Reg No: 3333333',
    name: 'BLUE MOON',
    sire: 'SAME PARENT',
    dam: 'OTHER PARENT',
    review: false,
  },
  {
    id: 'ancestor-dam-of-dam-name',
    text: 'Registered Name: BLUE MOON\nSire: SAME PARENT Reg No: 1111111\nDam: OTHER PARENT Reg No: 2222222\nDam of Dam: GRAND PARENT Reg No: 3333333',
    name: 'BLUE MOON',
    sire: 'SAME PARENT',
    dam: 'OTHER PARENT',
    review: false,
  },
  {
    id: 'ancestor-dam-of-dam-registration',
    text: 'Registered Name: BLUE MOON\nSire: SAME PARENT Reg No: 1111111\nDam: OTHER PARENT Reg No: 2222222\nDam of Dam Registration Number: 3333333',
    name: 'BLUE MOON',
    sire: 'SAME PARENT',
    dam: 'OTHER PARENT',
    review: false,
  },
  {
    id: 'ancestor-dam-of-dam-name-prefix',
    text: 'Registered Name: BLUE MOON\nSire: SAME PARENT Reg No: 1111111\nDam: OTHER PARENT Reg No: 2222222\nName of Dam of Dam: GRAND PARENT Reg No: 3333333',
    name: 'BLUE MOON',
    sire: 'SAME PARENT',
    dam: 'OTHER PARENT',
    review: false,
  },

  {
    id: 'parent-registration-prefix-repeat',
    text: 'Registered Name: BLUE MOON\nSire: SAME PARENT Reg No: AQHA1234567\nSire: SAME PARENT Reg No: 1234567',
    name: 'BLUE MOON',
    sire: 'SAME PARENT',
    review: false,
  },
  {
    id: 'parent-registration-registry-conflict',
    text: 'Registered Name: BLUE MOON\nSire: SAME PARENT Reg No: AQHA1234567\nSire: SAME PARENT Reg No: APHA1234567',
    name: 'BLUE MOON',
    sire: undefined,
    review: true,
  },
  {
    id: 'parent-registration-suffix-conflict',
    text: 'Registered Name: BLUE MOON\nDam: SAME PARENT Reg No: 1234567AA\nDam: SAME PARENT Reg No: 1234567AB',
    name: 'BLUE MOON',
    dam: undefined,
    review: true,
  },
  {
    id: 'parent-registration-long-conflict',
    text: 'Registered Name: BLUE MOON\nSire: SAME PARENT Reg No: 12345678901234567\nSire: SAME PARENT Reg No: 12345678901234568',
    name: 'BLUE MOON',
    sire: undefined,
    review: true,
  },
  {
    id: 'repeated-missing-parent-sentinels',
    text: 'Registered Name: BLUE MOON\nSire: UNKNOWN\nSire: N/A\nDam: Not recorded\nDam: Pending',
    name: 'BLUE MOON',
    sire: undefined,
    dam: undefined,
    review: false,
  },
  {
    id: 'parent-name-punctuation-repeat',
    text: 'Registered Name: BLUE MOON\nSire: UNKNOWN-SOLDIER\nSire: UNKNOWN SOLDIER',
    name: 'BLUE MOON',
    sire: 'UNKNOWN-SOLDIER',
    review: false,
  },
  {
    id: 'qualified-parent-name-not-subject',
    text: 'Registered Name: BLUE MOON\nSire Name: SAME PARENT\nDam Name: OTHER PARENT',
    name: 'BLUE MOON',
    sire: 'SAME PARENT',
    dam: 'OTHER PARENT',
    review: false,
  },

  {
    id: 'conflicting-sire-names',
    text: 'Registered Name: BLUE MOON\nSire: FIRST PARENT\nSire: SECOND PARENT',
    name: 'BLUE MOON',
    sire: undefined,
    review: true,
  },
  {
    id: 'conflicting-sire-registrations',
    text: 'Registered Name: BLUE MOON\nSire: SAME PARENT Registration Number: 1234567\nSire: SAME PARENT Registration Number: 7654321',
    name: 'BLUE MOON',
    sire: undefined,
    review: true,
  },
  {
    id: 'identical-sire-repetition',
    text: 'Registered Name: BLUE MOON\nRegistration Number: 5555555\nSire: SAME PARENT Reg No: 1234567\nSire: SAME PARENT Reg No: 1234567',
    name: 'BLUE MOON',
    review: false,
    sire: 'SAME PARENT',
  },
  {
    id: 'missing-then-real-sire',
    text: 'Registered Name: BLUE MOON\nSire: UNKNOWN\nSire: N/A\nSire: Not recorded\nSire: Pending\nSire: UNKNOWN SOLDIER',
    name: 'BLUE MOON',
    review: false,
    sire: 'UNKNOWN SOLDIER',
  },
  {
    id: 'qualified-sire-ancestor',
    text: 'Registered Name: BLUE MOON\nSire: SAME PARENT\nMaternal Sire: GRAND PARENT\nSire: SAME PARENT',
    name: 'BLUE MOON',
    review: false,
    sire: 'SAME PARENT',
  },
  {
    id: 'conflicting-dam-names',
    text: 'Registered Name: BLUE MOON\nDam: FIRST PARENT\nDam: SECOND PARENT',
    name: 'BLUE MOON',
    dam: undefined,
    review: true,
  },
  {
    id: 'conflicting-dam-registrations',
    text: 'Registered Name: BLUE MOON\nDam: SAME PARENT Registration Number: 1234567\nDam: SAME PARENT Registration Number: 7654321',
    name: 'BLUE MOON',
    dam: undefined,
    review: true,
  },
  {
    id: 'identical-dam-repetition',
    text: 'Registered Name: BLUE MOON\nRegistration Number: 5555555\nDam: SAME PARENT Reg No: 1234567\nDam: SAME PARENT Reg No: 1234567',
    name: 'BLUE MOON',
    review: false,
    dam: 'SAME PARENT',
  },
  {
    id: 'missing-then-real-dam',
    text: 'Registered Name: BLUE MOON\nDam: UNKNOWN\nDam: N/A\nDam: Not recorded\nDam: Pending\nDam: UNKNOWN SOLDIER',
    name: 'BLUE MOON',
    review: false,
    dam: 'UNKNOWN SOLDIER',
  },
  {
    id: 'qualified-dam-ancestor',
    text: 'Registered Name: BLUE MOON\nDam: SAME PARENT\nMaternal Dam: GRAND PARENT\nDam: SAME PARENT',
    name: 'BLUE MOON',
    review: false,
    dam: 'SAME PARENT',
  },
  {
    id: 'parent-registered-name-not-subject',
    text: 'Name: BLUE MOON\nRegistration Number: 5555555\nSire: SAME PARENT\nRegistered Name: SAME PARENT\nRegistration Number: 1234567',
    name: 'BLUE MOON',
    review: false,
  },
  {
    id: 'possessive-ancestor-not-parent',
    text: 'Registered Name: BLUE MOON\nSire: SAME PARENT\nDam: OTHER PARENT\nSire’s Sire: GRAND PARENT\nDam’s Dam: GRAND MOTHER',
    name: 'BLUE MOON',
    sire: 'SAME PARENT',
    dam: 'OTHER PARENT',
    review: false,
  },

  {
    id: 'absent-pedigree-0',
    text: 'Registered Name: BLUE MOON\nSire: UNKNOWN\nDam: UNKNOWN',
    name: 'BLUE MOON',
    sire: undefined,
    dam: undefined,
  },
  {
    id: 'absent-pedigree-1',
    text: 'Registered Name: BLUE MOON\nSire: N/A\nDam: N/A',
    name: 'BLUE MOON',
    sire: undefined,
    dam: undefined,
  },
  {
    id: 'absent-pedigree-2',
    text: 'Registered Name: BLUE MOON\nSire: Not recorded\nDam: Not recorded',
    name: 'BLUE MOON',
    sire: undefined,
    dam: undefined,
  },
  {
    id: 'absent-pedigree-3',
    text: 'Registered Name: BLUE MOON\nSire: Pending\nDam: Pending',
    name: 'BLUE MOON',
    sire: undefined,
    dam: undefined,
  },
  {
    id: 'real-parent-name-including-placeholder-word',
    text: 'Registered Name: BLUE MOON\nSire: UNKNOWN SOLDIER\nDam: PENDING SUNRISE',
    name: 'BLUE MOON',
    sire: 'UNKNOWN SOLDIER',
    dam: 'PENDING SUNRISE',
  },

  {
    id: 'registration-long-id',
    text: 'Registered Name: BLUE MOON\nRegistration Number: 12345678901234567',
    name: 'BLUE MOON',
    reg: '12345678901234567',
  },
  {
    id: 'subject-names-conflict',
    text: 'Registered Name: BLUE MOON\nRegistration Number: 1234567\nRegistered Name: RED SUN\nRegistration Number: 7654321',
    name: 'BLUE MOON',
    review: true,
  },
  {
    id: 'subject-numbers-conflict',
    text: 'Registered Name: BLUE MOON\nRegistration Number: 1234567\nRegistration Number: 7654321',
    name: 'BLUE MOON',
    review: true,
  },
  {
    id: 'same-subject-repeated',
    text: 'Registered Name: BLUE MOON\nRegistration Number: 1234567\nRegistered Name: BLUE MOON\nRegistration Number: 1234567',
    name: 'BLUE MOON',
    review: false,
  },
  {
    id: 'same-registration-prefix-repeat',
    text: 'Registered Name: BLUE MOON\nRegistration Number: AQHA1234567\nReg No: 1234567',
    name: 'BLUE MOON',
    review: false,
  },
  {
    id: 'same-name-punctuation-repeat',
    text: 'Registered Name: BLUE-MOON\nRegistration Number: 1234567\nHorse Name: BLUE MOON',
    name: 'BLUE-MOON',
    review: false,
  },
  {
    id: 'same-number-other-registry',
    text: 'Registered Name: BLUE MOON\nRegistration Number: AQHA1234567\nRegistration Number: APHA1234567',
    name: 'BLUE MOON',
    review: true,
  },
  // Identifiers are evidence, so suffixes must not be silently dropped.
  {
    id: 'registration-suffix-aa',
    text: 'Registered Name: BLUE MOON\nRegistration Number: 1234567AA',
    name: 'BLUE MOON',
    reg: '1234567AA',
  },
  {
    id: 'registration-suffix-ab',
    text: 'Registered Name: BLUE MOON\nRegistration Number: 1234567AB\nSex: Mare',
    name: 'BLUE MOON',
    reg: '1234567AB',
  },
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
  // A repeated explicit label (multi-page OCR flattened together) must end the
  // first value, not be consumed into it: the name is STAR, not
  // "STAR Animal Name: STAR". The variants must be stop boundaries too.
  {
    id: 'repeated-name-label',
    text: 'Animal Name: STAR Animal Name: STAR Registration Number 1234567',
    name: 'STAR',
    reg: '1234567',
  },
  // OCR that preserved the form's line breaks: the name ends at its own line, so
  // a following field whose label isn't enumerated ("Year Foaled") does not leak
  // its leading word into the name ("STAR Year").
  {
    id: 'name-ends-at-line',
    text: 'Horse Name: STAR\nYear Foaled: 2020\nRegistration Number 1234567',
    name: 'STAR',
    reg: '1234567',
  },
  // The other half of line-boundary handling: a value OCR wrapped onto the next
  // line (no field label, no field syntax on that line) is a continuation, not
  // a new field, so the whole name is kept -- not truncated at the first line.
  {
    id: 'name-wraps-line',
    text: 'Registered Name: LUCKY\nNUMBER SEVEN\nRegistration Number 1234567',
    name: 'LUCKY NUMBER SEVEN',
    reg: '1234567',
  },
];

test('the server extraction corpus holds, every row', () => {
  const failures = [];

  for (const row of CORPUS) {
    const fields = extractRegistrationFields(row.text);
    const actual = {
      review: detectMultipleHorses(row.text).multiple,
      name: fields.name?.value,
      reg: fields.registrationNumber?.value,
      sire: fields.sire?.value,
      dam: fields.dam?.value,
    };

    for (const key of ['name', 'reg', 'sire', 'dam', 'review']) {
      if (!(key in row)) continue;
      if (actual[key] !== row[key]) {
        failures.push(`${row.id} -> ${key}: got ${JSON.stringify(actual[key])}, want ${JSON.stringify(row[key])}`);
      }
    }
  }

  assert.deepEqual(failures, [], `\n${failures.join('\n')}\n`);
});

// Parse the browser corpus's expected values straight from its source, so the
// drift check compares expectations, not just case ids. Each row is a JS object
// literal; the browser file is case-sensitive TS, so a lowercased `name:` etc.
// only ever appears in key position (the raw `text` values carry "Name:",
// "Sire:", "Dam:" with capitals). Registry prefixes differ by design between the
// two copies (the server keeps them, the browser strips them), so a leading
// 2-5 letter registry code is normalized off both sides before comparing `reg`.
function parseBrowserCorpus(source) {
  const start = source.indexOf('const CORPUS');
  const end = source.indexOf('];', start);
  const body = source.slice(start, end);
  const idMatches = [...body.matchAll(/id:\s*'([^']+)'/g)];
  const rows = {};
  for (let i = 0; i < idMatches.length; i += 1) {
    const from = idMatches[i].index;
    const to = i + 1 < idMatches.length ? idMatches[i + 1].index : body.length;
    const slice = body.slice(from, to);
    const row = {};
    for (const key of ['name', 'reg', 'sire', 'dam', 'review']) {
      const match = slice.match(new RegExp(`\\b${key}:\\s*(?:'([^']*)'|(undefined)|(true|false))`));
      if (match) row[key] = match[3] ? match[3] === 'true' : match[2] === 'undefined' ? undefined : match[1];
    }
    rows[idMatches[i][1]] = row;
  }
  return rows;
}

const stripRegistry = (value) => (typeof value === 'string' ? value.replace(/^[A-Z]{2,5}/, '') : value);

test('the server corpus stays in step with the browser corpus', () => {
  // The two extractors are copies pinned to the same contract, so their corpora
  // must too. Comparing only case ids would let an existing row's expected name
  // (or sire/dam/reg) change on one side while the other keeps the old value and
  // both suites still pass -- the exact drift this guard exists to catch.
  const clientSource = readFileSync(new URL('../registrationExtractionCorpus.test.ts', import.meta.url), 'utf8');
  const browser = parseBrowserCorpus(clientSource);
  const browserIds = Object.keys(browser).sort();
  const serverIds = CORPUS.map((row) => row.id).sort();

  assert.ok(browserIds.length > 0, 'precondition: the browser corpus rows were found');
  assert.deepEqual(
    serverIds,
    browserIds,
    'server and browser extraction corpora must cover the same cases; add the missing row to whichever side lacks it',
  );

  const mismatches = [];
  for (const row of CORPUS) {
    const expected = browser[row.id];
    for (const key of ['name', 'reg', 'sire', 'dam', 'review']) {
      const inServer = key in row;
      const inBrowser = key in expected;
      if (inServer !== inBrowser) {
        mismatches.push(`${row.id} -> ${key}: asserted on ${inServer ? 'server' : 'browser'} only`);
        continue;
      }
      if (!inServer) continue;
      const a = key === 'reg' ? stripRegistry(row[key]) : row[key];
      const b = key === 'reg' ? stripRegistry(expected[key]) : expected[key];
      if (a !== b) {
        mismatches.push(
          `${row.id} -> ${key}: server ${JSON.stringify(row[key])} vs browser ${JSON.stringify(expected[key])}`,
        );
      }
    }
  }
  assert.deepEqual(mismatches, [], `\n${mismatches.join('\n')}\n`);
});
