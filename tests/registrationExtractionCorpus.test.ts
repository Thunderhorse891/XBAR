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
  review?: boolean;
  id: string;
  text: string;
  name?: string;
  reg?: string;
  sire?: string;
  dam?: string;
  sireReg?: string;
  damReg?: string;
};

// BEGIN PARENT FIELD BOUNDARY CORPUS
// Explicit neighboring fields end the parent identity on a flattened or wrapped
// line. Include absent, bare and labeled parent IDs so unrelated numbers never
// become a first ID or a conflicting second ID. Delimiterless numeric fields
// require an existing parent ID; PHONE 1111111 alone can be a real parent.
// The server pins this matrix to the browser copy below; only the browser API
// exposes the parent IDs directly.
const PARENT_BOUNDARY_FIELDS = [
  ['Phone', '5551234567'],
  ['Telephone Number', '5551234567'],
  ['Tel.', '5551234567'],
  ['Mobile Phone', '5551234567'],
  ['Cell Phone', '5551234567'],
  ['Fax Number', '5551234567'],
  ['UELN', '840123456789012'],
  ['Universal Equine Life Number', '840123456789012'],
  ['Passport No.', '987654321'],
  ['Date of Birth', '20200302'],
  ['Birth Date', '20200302'],
  ['DOB', '20200302'],
  ['Date Foaled', '20200302'],
  ['Year Foaled', '2020'],
  ['Date', '20200302'],
  ['Born', '20200302'],
  ['Weight', '1050'],
  ['Invoice No.', '3333333'],
  ['Lot Number', '3333333'],
  ['Batch Number', '3333333'],
  ['Account Number', '3333333'],
  ['Member ID', '3333333'],
  ['Reference Number', '3333333'],
  ['Document Number', '3333333'],
  ['Certificate Number', '3333333'],
  ['Registry Number', '3333333'],
  ['Association Number', '3333333'],
  ['Contact Number', '5551234567'],
  ['Postal Code', '90210'],
  ['ZIP Code', '90210'],
];
const PARENT_BOUNDARY_CORPUS = PARENT_BOUNDARY_FIELDS.flatMap(([field, value]) =>
  [' ', '\n'].flatMap((gap) =>
    [':', '#', '=', ''].flatMap((separator) =>
      ['sire', 'dam'].flatMap((parent) =>
        ['', ' 1111111AA', ' Reg No: 1111111AA']
          .filter((registration) => Boolean(separator || registration))
          .map((registration) => ({
            id: `parent-boundary-${field}-${JSON.stringify(gap)}-${separator}-${parent}-${registration}`,
            text: `Registered Name: BLUE MOON\n${parent}: DAD${registration}${gap}${field}${separator} ${value}${gap}${parent === 'sire' ? 'Dam' : 'Sire'}: MOM 2222222`,
            name: 'BLUE MOON',
            sire: parent === 'sire' ? 'DAD' : 'MOM',
            dam: parent === 'dam' ? 'DAD' : 'MOM',
            sireReg: parent === 'sire' ? (registration ? '1111111AA' : undefined) : '2222222',
            damReg: parent === 'dam' ? (registration ? '1111111AA' : undefined) : '2222222',
            review: false,
          })),
      ),
    ),
  ),
);
// A bare pedigree word inside a value is data. Exercise both parents, field
// dividers, numeric/labeled/absent IDs, and same-line/next-line actual fields.
const PARENT_ASSERTION_CORPUS = [
  'MY SIRE IS GREAT',
  'MY DAM IS GREAT',
  'MY SIRE AND DAM ARE GREAT',
  '*MY SIRE IS GREAT',
  '“MY DAM IS GREAT”',
].flatMap((name) =>
  ['sire', 'dam'].flatMap((parent) =>
    [':', '|', '___', ''].flatMap((divider) =>
      ['', ' 1111111AA', ' Reg No: 1111111AA'].flatMap((registration) =>
        [' ', '\n'].map((gap) => ({
          id: `parent-value-word-${name}-${parent}-${divider}-${registration}-${JSON.stringify(gap)}`,
          text: `Registered Name: BLUE MOON\n${parent} ${divider} ${name}${registration}${gap}${parent === 'sire' ? 'Dam' : 'Sire'}: OTHER PARENT 2222222`,
          name: 'BLUE MOON',
          sire: parent === 'sire' ? name : 'OTHER PARENT',
          dam: parent === 'dam' ? name : 'OTHER PARENT',
          sireReg: parent === 'sire' ? (registration ? '1111111AA' : undefined) : '2222222',
          damReg: parent === 'dam' ? (registration ? '1111111AA' : undefined) : '2222222',
          review: false,
        })),
      ),
    ),
  ),
);
// END PARENT FIELD BOUNDARY CORPUS

const CORPUS: ExtractionCase[] = [
  {
    id: 'bare-parent-label-after-registration-is-an-assertion',
    text: 'Sire MY SIRE IS GREAT 1111111 Dam MY DAM IS GREAT 2222222',
    sire: 'MY SIRE IS GREAT',
    dam: 'MY DAM IS GREAT',
    review: false,
  },
  {
    id: 'bare-parent-repetition-after-registration-retains-name-conflict',
    text: 'Sire FIRST PARENT 1111111 Sire SECOND PARENT 1111111',
    sire: undefined,
    review: true,
  },
  {
    id: 'bare-parent-repetition-after-registration-retains-id-conflict',
    text: 'Dam MY DAM IS GREAT AQHA1111111AA Dam MY DAM IS GREAT AQHA1111111AB',
    dam: undefined,
    review: true,
  },
  {
    id: 'bare-parent-repetition-after-registration-agrees',
    text: 'Sire MY SIRE IS GREAT AQHA1111111AA Sire MY SIRE IS GREAT 1111111AA',
    sire: 'MY SIRE IS GREAT',
    review: false,
  },
  {
    id: 'bare-parent-lines-without-ids-remain-fields',
    text: 'Sire MY SIRE IS GREAT\nDam MY DAM IS GREAT',
    sire: 'MY SIRE IS GREAT',
    dam: 'MY DAM IS GREAT',
    review: false,
  },
  {
    id: 'bare-parent-repetition-on-next-line-retains-name-conflict',
    text: 'Sire FIRST PARENT\nSire SECOND PARENT',
    sire: undefined,
    review: true,
  },
  {
    id: 'bare-parent-columns-without-ids-remain-fields',
    text: 'Sire MY SIRE IS GREAT | Dam MY DAM IS GREAT',
    sire: 'MY SIRE IS GREAT',
    dam: 'MY DAM IS GREAT',
    review: false,
  },
  {
    id: 'bare-parent-repetition-after-semicolon-retains-name-conflict',
    text: 'Sire FIRST PARENT; Sire SECOND PARENT',
    sire: undefined,
    review: true,
  },
  {
    id: 'explicit-parent-repetition-after-interior-word-retains-name-conflict',
    text: 'Sire: MY SIRE IS GREAT Sire: SECOND PARENT',
    sire: undefined,
    review: true,
  },
  {
    id: 'qualified-parent-fields-survive-interior-pedigree-words',
    text: 'Sire Name MY SIRE IS GREAT Dam Name MY DAM IS GREAT',
    sire: 'MY SIRE IS GREAT',
    dam: 'MY DAM IS GREAT',
    review: false,
  },
  {
    id: 'qualified-ancestor-value-interior-word-is-not-parent',
    text: 'Sire DAD 1111111 Dam MOM 2222222 Sire of Sire MY SIRE IS GREAT 3333333',
    sire: 'DAD',
    dam: 'MOM',
    review: false,
  },
  {
    id: 'bare-parent-after-missing-sentinel-remains-field',
    text: 'Sire UNKNOWN Sire MY SIRE IS GREAT 1111111 Dam N/A',
    sire: 'MY SIRE IS GREAT',
    dam: undefined,
    review: false,
  },
  {
    id: 'numeric-metadata-word-at-parent-value-start-is-a-name',
    text: 'Sire: PHONE 1111111 Dam: UELN 2222222',
    sire: 'PHONE',
    dam: 'UELN',
    review: false,
  },
  {
    id: 'numeric-metadata-boundary-retains-prior-registration-conflict',
    text: 'Sire: SAME PARENT Reg No: 1111111AA Registration Number: 1111111AB Phone 5551234567',
    sire: undefined,
    review: true,
  },
  {
    id: 'curly-quoted-parent-value-starting-with-parent-word',
    text: 'Sire: “SIRE POWER” 1111111 Dam: ‘DAM GOOD’ 2222222',
    sire: '“SIRE POWER”',
    dam: '‘DAM GOOD’',
    review: false,
  },
  {
    id: 'attached-dash-parent-value-starting-with-parent-word',
    text: 'Sire: –DAM GOOD 1111111 Phone: 5551234567 Dam: —SIRE POWER 2222222',
    sire: '–DAM GOOD',
    dam: '—SIRE POWER',
    review: false,
  },
  {
    id: 'parent-value-starting-with-parent-word',
    text: 'Registered Name: BLUE MOON\nSire: SIRE POWER 1111111\nDam: DAM GOOD 2222222',
    name: 'BLUE MOON',
    sire: 'SIRE POWER',
    dam: 'DAM GOOD',
    review: false,
  },
  {
    id: 'parent-value-starting-with-opposite-parent-word',
    text: 'Sire: DAM GOOD 1111111 Dam: SIRE POWER 2222222',
    sire: 'DAM GOOD',
    dam: 'SIRE POWER',
    review: false,
  },
  {
    id: 'bare-parent-value-starting-with-parent-word',
    text: 'Sire SIRE POWER 1111111 Dam DAM GOOD 2222222',
    sire: 'SIRE POWER',
    dam: 'DAM GOOD',
    review: false,
  },
  {
    id: 'wrapped-parent-value-starting-with-parent-word',
    text: 'Sire:\nSIRE POWER\nDam:\nDAM GOOD',
    sire: 'SIRE POWER',
    dam: 'DAM GOOD',
    review: false,
  },
  {
    id: 'punctuated-parent-value-starting-with-parent-word',
    text: 'Name of Sire: "SIRE POWER" 1111111 Name of Dam: *DAM GOOD 2222222',
    sire: '"SIRE POWER"',
    dam: '*DAM GOOD',
    review: false,
  },
  {
    id: 'ancestor-value-starting-with-parent-word-is-not-parent',
    text: 'Sire: DAD 1111111 Dam: MOM 2222222 Sire of Sire: SIRE POWER 3333333',
    sire: 'DAD',
    dam: 'MOM',
    review: false,
  },
  {
    id: 'parent-value-word-guard-does-not-hide-name-conflict',
    text: 'Sire: SIRE POWER 1111111 Phone: 5551234567 Sire: SIRE OTHER 1111111',
    sire: undefined,
    review: true,
  },
  {
    id: 'empty-parent-before-repeated-explicit-parent-label',
    text: 'Sire: Sire: DAD 1111111 Dam: Dam: MOM 2222222',
    sire: 'DAD',
    dam: 'MOM',
    review: false,
  },
  {
    id: 'phone-boundary-preserves-parent-name',
    text: 'Registered Name: CALL MY PHONE\nSire: CALL MY PHONE 1111111 Phone: 5551234567\nDam: THE LAST PASSPORT 2222222 UELN: 840123456789012',
    name: 'CALL MY PHONE',
    sire: 'CALL MY PHONE',
    dam: 'THE LAST PASSPORT',
    review: false,
  },
  {
    id: 'metadata-words-in-parent-name-are-not-labels',
    text: 'Sire: PHONE NUMBER SEVEN 1111111\nDam: UNIVERSAL EQUINE LIFE NUMBER DREAM 2222222',
    sire: 'PHONE NUMBER SEVEN',
    dam: 'UNIVERSAL EQUINE LIFE NUMBER DREAM',
    review: false,
  },
  {
    id: 'empty-parent-before-explicit-number',
    text: 'Sire: Phone: 5551234567\nDam: Tel.: 5559876543',
    sire: undefined,
    dam: undefined,
    review: false,
  },
  {
    id: 'empty-parent-before-explicit-id',
    text: 'Sire: UELN: 840123456789012\nDam: Passport No.: 987654321',
    sire: undefined,
    dam: undefined,
    review: false,
  },
  {
    id: 'metadata-boundary-does-not-hide-repeated-parent-name-conflict',
    text: 'Sire: FIRST PARENT 1111111 Phone: 5551234567 Sire: SECOND PARENT 1111111 UELN: 840123456789012',
    sire: undefined,
    review: true,
  },
  {
    id: 'metadata-boundary-does-not-hide-repeated-parent-id-conflict',
    text: 'Dam: SAME PARENT 1111111AA UELN: 840123456789012\nDam: SAME PARENT 1111111AB Phone: 5551234567',
    dam: undefined,
    review: true,
  },
  {
    id: 'metadata-boundary-does-not-hide-same-entry-registration-conflict',
    text: 'Sire: SAME PARENT Reg No: 1111111AA Registration Number: 1111111AB Phone: 5551234567',
    sire: undefined,
    review: true,
  },
  {
    id: 'metadata-boundary-preserves-repeat-and-qualified-ancestor',
    text: 'Sire: SAME PARENT Reg No: AQHA1111111AA Phone: 5551234567\nSire: SAME PARENT Reg No: 1111111AA\nSire of Sire: GRAND PARENT 3333333 UELN: 840123456789012\nDam: OTHER PARENT 2222222',
    sire: 'SAME PARENT',
    dam: 'OTHER PARENT',
    review: false,
  },
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

test('the extraction corpus holds, every row', () => {
  const failures: string[] = [];

  const cases: ExtractionCase[] = [...CORPUS, ...PARENT_BOUNDARY_CORPUS, ...PARENT_ASSERTION_CORPUS];
  for (const row of cases) {
    const fields = extractRegistrationFields(row.text);
    const actual = {
      review: fields.identityReviewRequired ?? false,
      name: fields.horseName,
      reg: fields.registrationNumber,
      sire: fields.sire,
      dam: fields.dam,
      sireReg: fields.sireRegistration,
      damReg: fields.damRegistration,
    };

    for (const key of ['name', 'reg', 'sire', 'dam', 'sireReg', 'damReg', 'review'] as const) {
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
