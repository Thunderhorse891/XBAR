// Pure extraction logic for the OCR ingestion pipeline. No I/O here so the
// classification, field parsing, and merge rules stay unit-testable.

export const NEEDS_REVIEW_THRESHOLD = 0.9;

// Canonical pipeline types mapped to the document_type values the frontend
// already renders (src/types/xbar.ts DocumentType).
export const DOCUMENT_TYPE_LABELS = {
  registration: 'Registration',
  coggins: 'Coggins',
  health_cert: 'Vet Record',
  transfer: 'Transfer Packet',
  bill_of_sale: 'Bill of Sale',
  unknown: 'Ownership Memo',
};

const CLASSIFIERS = [
  { type: 'coggins', pattern: /equine\s+infectious\s+anemia|coggins|\bEIA\b|AGID|ELISA\s+test/i, weight: 0.97 },
  {
    type: 'health_cert',
    pattern:
      /certificate\s+of\s+veterinary\s+inspection|health\s+certificate|\bCVI\b|interstate\s+(travel|movement|shipment)/i,
    weight: 0.95,
  },
  { type: 'transfer', pattern: /transfer\s+of\s+ownership|transfer\s+report|ownership\s+transfer/i, weight: 0.95 },
  { type: 'bill_of_sale', pattern: /bill\s+of\s+sale|purchase\s+agreement/i, weight: 0.95 },
  {
    type: 'registration',
    pattern:
      /certificate\s+of\s+registration|registration\s+certificate|breed\s+registry|jockey\s+club|arabian\s+horse\s+association|\bAHA\b|\bAQHA\b|\bUSEF\b|\bAPHA\b/i,
    weight: 0.93,
  },
];

export function classifyDocumentType(text) {
  const source = String(text || '');
  for (const classifier of CLASSIFIERS) {
    if (classifier.pattern.test(source)) {
      return { type: classifier.type, confidence: classifier.weight };
    }
  }

  if (/registration\s*(no|number|#)/i.test(source) && /(sire|dam|breeder|foaled)/i.test(source)) {
    return { type: 'registration', confidence: 0.8 };
  }

  return { type: 'unknown', confidence: 0.3 };
}

function captureField(text, patterns, options = {}) {
  const source = String(text || '');
  for (let index = 0; index < patterns.length; index += 1) {
    const match = source.match(patterns[index]);
    if (match?.[1]) {
      const value = cleanValue(match[1], options);
      if (value) {
        // Earlier patterns are more specific, so confidence decays per fallback.
        return { value, confidence: Math.max(0.55, (options.baseConfidence ?? 0.95) - index * 0.1) };
      }
    }
  }
  return null;
}

function cleanValue(raw, options = {}) {
  let value = String(raw).replace(/\s+/g, ' ').trim();
  value = value.replace(/[|;,:]+$/g, '').trim();
  if (options.uppercase) {
    value = value.toUpperCase();
  }
  if (options.maxLength && value.length > options.maxLength) {
    value = value.slice(0, options.maxLength).trim();
  }
  return value;
}

export function normalizeDate(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';

  const iso = value.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }

  const us = value.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`;
  }

  const months = [
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
  ];
  const written = value.match(/^([a-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (written) {
    const monthIndex = months.findIndex((month) => month.startsWith(written[1].toLowerCase()));
    if (monthIndex >= 0) {
      return `${written[3]}-${String(monthIndex + 1).padStart(2, '0')}-${written[2].padStart(2, '0')}`;
    }
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return '';
}

export function addOneYear(isoDate) {
  const match = String(isoDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return '';
  return `${Number(match[1]) + 1}-${match[2]}-${match[3]}`;
}

const DATE_VALUE =
  '([A-Za-z]+\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}[-/]\\d{1,2}[-/]\\d{2,4}|\\d{4}[-/]\\d{1,2}[-/]\\d{1,2})';
const NAME_VALUE = "([A-Za-z][A-Za-z0-9 .,'&-]{1,60})";
const LINE_END = '(?:\\r?\\n|$)';

function dateField(text, labels) {
  const patterns = labels.map((label) => new RegExp(`${label}\\s*[:#-]?\\s*${DATE_VALUE}`, 'i'));
  const captured = captureField(text, patterns);
  if (!captured) return null;
  const normalized = normalizeDate(captured.value);
  if (!normalized) return null;
  return { value: normalized, confidence: captured.confidence };
}

function nameField(text, labels, options = {}) {
  const patterns = labels.map((label) => new RegExp(`${label}\\s*[:#-]?\\s*${NAME_VALUE}${LINE_END}`, 'i'));
  return captureField(text, patterns, options);
}

/*
 * -------------------------------------------------------------------------
 * Horse-name / sire / dam reader, ported from the browser extractor.
 *
 * This is a faithful copy of the name-family logic in
 * src/lib/registrationExtraction.ts, which is pinned by
 * tests/registrationExtractionCorpus.test.ts to read names "the way a person
 * reading the paper would". The server cannot import that module -- it is a
 * Vite `@/`-aliased browser module, and this file runs in the serverless
 * runtime -- so the logic is duplicated here, exactly as api/_lib/permissions.js
 * duplicates src/lib/permissions.ts.
 *
 * A comment is not a mechanism: tests/api/serverRegistrationExtraction.test.mjs
 * runs the SAME corpus rows through this reader and fails the build if the two
 * copies drift. The naive `Label: (value up to end-of-line)` reader this
 * replaced happily named a horse after its owner ("Name of Owner ERIN WYRICK")
 * or after separator junk, then handed that to the review queue as fact.
 * -------------------------------------------------------------------------
 */

// Registry bodies whose presence identifies the paper and whose codes prefix
// registration numbers. Longest-first so "APHC" wins over "AHA" etc.
const REGISTRIES = ['AQHA', 'APHA', 'ApHC', 'APHC', 'JC', 'USEF', 'AHA', 'ABRA', 'PtHA', 'IBHA', 'PHBA', 'APHASSOC'];

// Known coat colors, longest phrases first so "blue roan" beats "roan". Only
// used here to recognize a colour value that follows a ruled-blank name label.
const NAME_COLORS = [
  'blue roan',
  'red roan',
  'bay roan',
  'strawberry roan',
  'red dun',
  'dark bay',
  'dark brown',
  'liver chestnut',
  'flea-bitten gray',
  'flea bitten gray',
  'dapple gray',
  'dapple grey',
  'grullo',
  'grulla',
  'palomino',
  'buckskin',
  'cremello',
  'perlino',
  'champagne',
  'chestnut',
  'sorrel',
  'chocolate',
  'brown',
  'black',
  'bay',
  'gray',
  'grey',
  'roan',
  'dun',
  'white',
  'gold',
  'cream',
  'pinto',
  'tobiano',
  'overo',
  'paint',
];

const OWNER_LABELS = 'current\\s+owner|recorded\\s+owner|owner\\s+of\\s+record|owner';

/*
 * A line holding nothing but a word that qualifies a following `Name` field.
 * Used to tell a label OCR split across a line break ("Association" / "Name:
 * AQHA") from letterhead sitting above a genuine field ("Blue River Farm" /
 * "Name: BLUE MOON"), which carries more than the bare qualifier.
 */
const QUALIFIER_ONLY_LINE =
  /^(?:association|farm|ranch|stable|stables|barn|registry|company|corporation|club|owner|breeder|sire|dam)$/i;

function parentLabel(label) {
  return `${label}(?:['’]s)?(?:\\s+name)?|name\\s+of\\s+${label}`;
}

// Label tokens that mark the start of the *next* field. A captured value stops
// when one of these appears, so "Sire: SHINING SPARK Dam: ..." splits cleanly.
const STOP_LABELS = [
  'registered\\s+name',
  'name\\s+of\\s+horse',
  "horse(?:['’]s)?\\s+name",
  'animal\\s+name',
  'registration',
  'reg\\.?\\s*(?:no|number|#)',
  'certificate',
  'registry',
  'association',
  'foaled',
  'foaling',
  'date\\s+foaled',
  'birth',
  'sex',
  'gender',
  'colou?r',
  'breed',
  parentLabel('sire'),
  parentLabel('dam'),
  'breeder',
  OWNER_LABELS,
  'microchip',
  'markings?',
  'tattoo',
  'height',
  'dna',
  'panel',
  'signature',
  // NB: no bare 'number'. A real registered name can contain "Number" ("LUCKY
  // NUMBER SEVEN"), and a bare stop there truncated it to "LUCKY". The horse's
  // own "Registration Number" field is already caught by 'registration' and
  // 'reg no/number' above, so the bare token only ever did harm.
];

const STOP_GROUP = STOP_LABELS.join('|');
const SEX_VALUE = '(?:gelding|stallion|stud|colt|filly|mare)';
const COLOR_VALUE = `(?:${NAME_COLORS.map((color) => color.replace(/[-\s]/g, '[-\\s]')).join('|')})`;

// Boundaries that end a sire/dam entry. Deliberately excludes reg/registration
// so a parent's own "Reg No 0011223" tail stays inside the captured chunk.
const PARENT_STOP_GROUP = [
  parentLabel('sire'),
  parentLabel('dam'),
  'breeder',
  OWNER_LABELS,
  'foaled',
  'foaling',
  'colou?r',
  'sex',
  'gender',
  'markings?',
  'microchip',
  'tattoo',
  'height',
  'dna',
  'panel',
  'signature',
  'breed',
].join('|');

function normalizeWhitespace(value) {
  return String(value).replace(/\s+/g, ' ').trim();
}

// Remove field dividers and scan rules, preserving attached punctuation such
// as *RAFFLES, -STAR, quoted names and apostrophes. A single dot or dash is a
// divider only when followed by whitespace; repeated runs represent rules.
const LEADING_SEPARATORS = /^(?:(?:[|;,:#=•·]+|[_.\-–—~]{2,}|[_.\-–—~](?=\s))\s*)+/;

function cleanFieldValue(value) {
  if (value === undefined || value === null) return undefined;
  return String(value)
    .trim()
    .replace(LEADING_SEPARATORS, '')
    .replace(/[|;,:_.\-\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Capture the text that follows a label, up to (but not including) the next
 * known field label or the end of the string. Returns { value, start, end }.
 */
function labeledField(text, labelPattern, stopGroup = STOP_GROUP) {
  const label = text.match(new RegExp(`\\b(?:${labelPattern})\\b`, 'i'));
  if (!label || label.index === undefined) return undefined;
  const labelEnd = label.index + label[0].length;
  const rawRemainder = text.slice(labelEnd);
  const remainder = cleanFieldValue(rawRemainder);
  if (!remainder) return undefined;
  // A complete next-field label means the current field is empty. A bare
  // label word can still be data, as in COLOR ME BLUE or OWNER OF THE RANCH.
  if (new RegExp(`^(?:${stopGroup})\\s*[:#=|]`, 'i').test(remainder)) return undefined;
  if (stopGroup === STOP_GROUP && /^(?:registration|reg\.?)\s*(?:(?:number|no\.?)\b|#)/i.test(remainder)) {
    return undefined;
  }
  // Ruled blanks can be followed by labels with no colon. Recognize a whole
  // field/value pair, not a label word alone (COLOR ME BLUE is still a name).
  const ruled = /^\s*[:#]?\s*(?:[|;=•·]+|[_.\-–—~]{2,})/.test(rawRemainder);
  if (ruled) {
    /*
     * A sex/colour pair means the labelled field was EMPTY only when the pair
     * is the whole of what follows -- that is, when another field or the end of
     * the text comes next. Matching the pair alone discards real names that
     * merely begin with a field word: "COLOR BAY DREAM" is a horse, and the
     * only thing separating it from an empty name field above a "Color Bay"
     * field is that "DREAM" follows.
     */
    if (
      new RegExp(
        `^(?:(?:sex|gender)\\s+${SEX_VALUE}|colou?r\\s+${COLOR_VALUE})\\b(?=\\s*$|\\s+(?:${STOP_GROUP})\\b)`,
        'i',
      ).test(remainder)
    ) {
      return undefined;
    }
    if (
      stopGroup === PARENT_STOP_GROUP &&
      new RegExp(`^(?:${parentLabel('sire')}|${parentLabel('dam')})\\b`, 'i').test(remainder)
    ) {
      return undefined;
    }
  }
  const match = remainder.match(new RegExp(`^(.+?)(?=\\s+(?:${stopGroup})\\b|$)`, 'i'));
  const value = cleanFieldValue(match?.[1]);
  if (!value || value.length < 2) return undefined;
  const start = text.indexOf(value, labelEnd);
  return start >= 0 ? { value, start, end: start + value.length } : undefined;
}

function labeledValue(text, labelPattern, stopGroup = STOP_GROUP) {
  return labeledField(text, labelPattern, stopGroup)?.value;
}

/** A sire/dam entry: the parent's name plus, when present, its registration number. */
function findParent(text, label) {
  const chunk = labeledValue(text, parentLabel(label), PARENT_STOP_GROUP);
  if (!chunk || chunk.length < 2) return {};
  // The registration number, if any, trails the name within the chunk.
  const regMatch = chunk.match(
    new RegExp(`\\b(?:${REGISTRIES.join('|')})?\\s*[:#-]?\\s*([A-Z]?\\d[\\d\\s-]{4,12}\\d)\\b`, 'i'),
  );
  const registration = regMatch ? regMatch[1].replace(/[\s-]/g, '').toUpperCase() : undefined;
  let name = chunk;
  if (regMatch) {
    name = chunk.slice(0, regMatch.index).trim();
  }
  name = name
    .replace(new RegExp(`\\b(?:${REGISTRIES.join('|')})\\b`, 'ig'), '')
    .replace(/\b(?:reg\.?\s*(?:no|number|#)?)\b/gi, '')
    // A registration field printed right after the parent name -- the horse's
    // own, on a certificate that puts it after the pedigree -- leaves the full
    // word "Registration" (and "Number"/"No") clinging to the parent name once
    // its digits are split off, e.g. "MOM Registration Number". Strip that tail
    // so the parent name is just "MOM"; the digits stay in `registration`.
    .replace(/\s*registration(?:\s+(?:number|no))?\.?\s*$/i, '')
    .replace(/[|;,:#.\-\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { name: name.length >= 2 ? name : undefined, registration };
}

function findHorseNames(text, lineStarts) {
  // Keep candidates until the parent boundary is known. An explicit name in
  // the sire section must not displace the horse's earlier bare Name field.
  const candidates = [];
  // When OCR preserved the form's line breaks, a labeled name ends at its own
  // line. Flattening joins lines with a space, so without this a following
  // field whose label isn't in STOP_LABELS (e.g. "Year Foaled") leaks its
  // leading word into the name ("STAR Year"). Bound the value at the next real
  // line start; fall back to the flattened slice when the value is empty on the
  // label's line, so a value OCR wrapped onto the next line is still read.
  const orderedLineStarts = [...lineStarts].sort((a, b) => a - b);
  const lineBoundedField = (index, labelPattern) => {
    const lineEnd = orderedLineStarts.find((start) => start > index) ?? text.length;
    // Only end the name at the line break when the NEXT line begins a new field
    // -- it carries field syntax (a colon/hash/equals) or a known label. A next
    // line with neither is a value OCR wrapped across the break ("LUCKY" /
    // "NUMBER SEVEN"), so read across it. This is what tells "STAR" above a
    // "Year Foaled:" field from "LUCKY" above its own continuation.
    if (lineEnd < text.length) {
      const nextEnd = orderedLineStarts.find((start) => start > lineEnd) ?? text.length;
      const nextLine = text.slice(lineEnd, nextEnd);
      const nextLineIsField = /[:#=]/.test(nextLine) || new RegExp(`\\b(?:${STOP_GROUP})\\b`, 'i').test(nextLine);
      if (nextLineIsField) {
        const bounded = labeledField(text.slice(index, lineEnd), labelPattern);
        if (bounded) return bounded;
      }
    }
    return labeledField(text.slice(index), labelPattern);
  };

  // Registries label the horse's name several ways. "Animal Name" and "Horse's
  // Name" are as explicit as "Registered Name"; missing them left the bare-Name
  // scan to reject the label as a qualifier and the horse came out unnamed.
  const explicitPattern = "registered\\s+name|name\\s+of\\s+horse|horse(?:['’]s)?\\s+name|animal\\s+name";
  for (const match of text.matchAll(new RegExp(`\\b(?:${explicitPattern})\\b`, 'ig'))) {
    const field = lineBoundedField(match.index, explicitPattern);
    if (field) candidates.push({ ...field, start: field.start + match.index, end: field.end + match.index });
  }

  for (const match of text.matchAll(/\bname\b/gi)) {
    const before = text.slice(0, match.index);
    const after = text.slice(match.index + match[0].length);
    // Do not turn another qualified field (Association Name, Farm Name, etc.)
    // into horse data. A bare Name starts a field or follows a numeric value.
    const prefix = before.trim();
    const followsHeading =
      /\bcertificate\s+of\s+registration$/i.test(prefix) ||
      REGISTRIES.some((registry) => registry.toLowerCase() === prefix.toLowerCase());
    const followsCompleteField = new RegExp(
      `\\b(?:(?:sex|gender)\\s*[:#=-]?\\s*${SEX_VALUE}|colou?r\\s*[:#=-]?\\s*${COLOR_VALUE})$`,
      'i',
    ).test(prefix);
    if (!lineStarts.has(match.index) && prefix && !/[\d|;]$/.test(prefix) && !followsHeading && !followsCompleteField)
      continue;
    if (/^\s+of\b/i.test(after)) continue;
    if (new RegExp(`\\b(?:sire|dam|${OWNER_LABELS}|breeder)(?:['’]s)?\\s*$`, 'i').test(before)) continue;
    if (new RegExp(`^\\s+(?:of\\s+)?(?:sire|dam|${OWNER_LABELS}|breeder)\\b`, 'i').test(after)) continue;
    const field = lineBoundedField(match.index, 'name');
    if (field) candidates.push({ ...field, start: field.start + match.index, end: field.end + match.index });
  }
  return candidates;
}

/**
 * Read the horse's own name, sire and dam, and the head text (everything before
 * the first sire/dam label) so the registration-number reader can be pointed at
 * it and never pick up a parent's number. Faithful to the browser extractor's
 * name-family behaviour; the corpus test pins the two together.
 */
function extractNameFamily(rawText) {
  const lines = String(rawText || '')
    .split(/\r\n?|\n/)
    .map(normalizeWhitespace)
    .filter(Boolean);
  const lineStarts = new Set();
  let offset = 0;
  lines.forEach((line, index) => {
    const previous = index > 0 ? lines[index - 1] : undefined;
    const splitQualifiedLabel = previous !== undefined && QUALIFIER_ONLY_LINE.test(previous);
    if (!splitQualifiedLabel) lineStarts.add(offset);
    offset += line.length + 1;
  });
  const text = lines.join(' ');
  if (!text) return { headText: '', horseName: undefined, sire: undefined, dam: undefined };

  const horseNames = findHorseNames(text, lineStarts);
  // A labeled name such as DAM GOOD contains data, not a parent-field label.
  const parentIndex =
    [...text.matchAll(new RegExp(`\\b(?:${parentLabel('sire')}|${parentLabel('dam')})\\b`, 'ig'))].find(
      (match) => !horseNames.some((name) => match.index >= name.start && match.index < name.end),
    )?.index ?? -1;
  const headText = parentIndex >= 0 ? text.slice(0, parentIndex) : text;
  const parentText = parentIndex >= 0 ? text.slice(parentIndex) : '';
  const horseName = horseNames.find((name) => parentIndex < 0 || name.start < parentIndex)?.value;

  const sire = findParent(parentText, 'sire').name;
  const dam = findParent(parentText, 'dam').name;
  return { headText, horseName, sire, dam };
}

export function extractRegistrationFields(text) {
  const fields = {};
  const nameFamily = extractNameFamily(text);
  if (nameFamily.horseName) fields.name = { value: nameFamily.horseName, confidence: 0.95 };

  // Registration number keeps the server convention (registry prefix retained,
  // whitespace stripped) but is read only from the head text -- the portion
  // before the first sire/dam label -- so a parent's own number is never taken
  // as the horse's. `tests/registrationExtractionCorpus.test.ts` row
  // `parent-only-frag` is exactly this case.
  const registration = captureField(
    nameFamily.headText,
    [
      /registration\s*(?:no|number|#)\.?\s*[:#-]?\s*([A-Z]{0,4}[\s-]?\d{4,10}[A-Z]?)/i,
      /reg\.?\s*(?:no|#)\.?\s*[:#-]?\s*([A-Z]{0,4}[\s-]?\d{4,10}[A-Z]?)/i,
    ],
    { uppercase: true, maxLength: 20 },
  );
  if (registration) fields.registrationNumber = { ...registration, value: registration.value.replace(/\s+/g, '') };

  const registry = captureField(
    text,
    [
      /(arabian\s+horse\s+association|jockey\s+club|american\s+quarter\s+horse\s+association|american\s+paint\s+horse\s+association|\bAHA\b|\bAQHA\b|\bAPHA\b|\bUSEF\b)/i,
    ],
    { maxLength: 50 },
  );
  if (registry) fields.registry = registry;

  const breed = nameField(text, ['breed'], { maxLength: 40 });
  if (breed) fields.breed = breed;

  const color = nameField(text, ['colou?r'], { maxLength: 30 });
  if (color) fields.color = color;

  const markings = nameField(text, ['markings'], { maxLength: 120 });
  if (markings) fields.markings = markings;

  const gender = captureField(text, [/\b(?:sex|gender)\s*[:#-]?\s*(stallion|mare|gelding|colt|filly|male|female)/i], {
    maxLength: 12,
  });
  if (gender) fields.gender = gender;

  const birthdate = dateField(text, ['(?:date\\s+)?foaled', 'foaling\\s+date', 'date\\s+of\\s+birth', 'birth\\s*date']);
  if (birthdate) fields.birthdate = birthdate;

  if (nameFamily.sire) fields.sire = { value: nameFamily.sire, confidence: 0.95 };
  if (nameFamily.dam) fields.dam = { value: nameFamily.dam, confidence: 0.95 };

  const dna = captureField(
    text,
    [/DNA\s*(?:status|test(?:ed)?)?\s*[:#-]?\s*(on\s+file|verified|parent\s+qualified|pending|not\s+on\s+file)/i],
    { maxLength: 30 },
  );
  if (dna) fields.dnaStatus = dna;

  const microchip = captureField(text, [/microchip\s*(?:no|number|#)?\.?\s*[:#-]?\s*(\d{9,15})/i], { maxLength: 15 });
  if (microchip) fields.microchip = microchip;

  return fields;
}

export function extractCogginsFields(text) {
  const fields = {};
  const name = nameField(text, ['(?:horse\\s+|animal\\s+)?name'], { maxLength: 60 });
  if (name) fields.name = name;

  const testDate = dateField(text, [
    '(?:test|sample|collection|drawn?)\\s*date',
    'date\\s+(?:of\\s+)?(?:test|sample|collection)',
    'date\\s+drawn',
  ]);
  if (testDate) {
    fields.testDate = testDate;
    const nextDue = addOneYear(testDate.value);
    if (nextDue) {
      fields.nextDueDate = { value: nextDue, confidence: testDate.confidence, derived: true };
    }
  }

  const labId = captureField(
    text,
    [/(?:lab(?:oratory)?|accession|case)\s*(?:id|no|number|#)\.?\s*[:#-]?\s*([A-Z0-9-]{4,20})/i],
    { uppercase: true, maxLength: 20 },
  );
  if (labId) fields.labId = labId;

  const result = captureField(
    text,
    [/(?:test\s+)?results?\s*[:#-]?\s*(negative|positive)/i, /\b(negative|positive)\b/i],
    { maxLength: 10 },
  );
  if (result) fields.result = { ...result, value: result.value.toLowerCase() };

  const registration = captureField(
    text,
    [/registration\s*(?:no|number|#)\.?\s*[:#-]?\s*([A-Z]{0,4}[\s-]?\d{4,10}[A-Z]?)/i],
    { uppercase: true, maxLength: 20 },
  );
  if (registration) fields.registrationNumber = { ...registration, value: registration.value.replace(/\s+/g, '') };

  const vet = nameField(text, ['veterinarian', 'vet(?:erinary)?\\s+name', 'attending\\s+veterinarian', 'DVM'], {
    maxLength: 60,
  });
  if (vet) fields.veterinarian = vet;

  return fields;
}

export function extractHealthCertFields(text) {
  const fields = {};
  const name = nameField(text, ['(?:horse\\s+|animal\\s+)?name'], { maxLength: 60 });
  if (name) fields.name = name;

  const examDate = dateField(text, [
    '(?:exam(?:ination)?|inspection)\\s*date',
    'date\\s+of\\s+(?:exam(?:ination)?|inspection)',
  ]);
  if (examDate) fields.examDate = examDate;

  const vet = nameField(text, ['veterinarian', 'issuing\\s+veterinarian', 'attending\\s+veterinarian', 'DVM'], {
    maxLength: 60,
  });
  if (vet) fields.veterinarian = vet;

  const destination = nameField(text, ['destination', 'consignee(?:\\s+address)?', 'shipping\\s+to'], {
    maxLength: 120,
  });
  if (destination) fields.destination = destination;

  const expiry = dateField(text, ['expir(?:y|ation)\\s*date', 'valid\\s+(?:through|until)', 'expires']);
  if (expiry) fields.expiryDate = expiry;

  return fields;
}

export function extractTransferFields(text) {
  const fields = {};
  const name = nameField(text, ['(?:horse\\s+)?name'], { maxLength: 60 });
  if (name) fields.name = name;

  const previousOwner = nameField(
    text,
    ['(?:previous|current|transferor|seller)\\s+owner(?:\\s+name)?', 'seller(?:\\s+name)?', 'transferor'],
    { maxLength: 80 },
  );
  if (previousOwner) fields.previousOwner = previousOwner;

  const previousOwnerAddress = nameField(text, ['(?:previous|seller)\\s+(?:owner\\s+)?address'], { maxLength: 140 });
  if (previousOwnerAddress) fields.previousOwnerAddress = previousOwnerAddress;

  const newOwner = nameField(text, ['(?:new|transferee)\\s+owner(?:\\s+name)?', 'buyer(?:\\s+name)?', 'transferee'], {
    maxLength: 80,
  });
  if (newOwner) fields.newOwner = newOwner;

  const newOwnerAddress = nameField(text, ['(?:new\\s+owner|buyer|transferee)\\s+address'], { maxLength: 140 });
  if (newOwnerAddress) fields.newOwnerAddress = newOwnerAddress;

  const saleDate = dateField(text, [
    'date\\s+of\\s+sale',
    'sale\\s+date',
    'transfer\\s+date',
    'date\\s+of\\s+transfer',
  ]);
  if (saleDate) fields.saleDate = saleDate;

  const registration = captureField(
    text,
    [/registration\s*(?:no|number|#)\.?\s*[:#-]?\s*([A-Z]{0,4}[\s-]?\d{4,10}[A-Z]?)/i],
    { uppercase: true, maxLength: 20 },
  );
  if (registration) fields.registrationNumber = { ...registration, value: registration.value.replace(/\s+/g, '') };

  return fields;
}

const EXTRACTORS = {
  registration: extractRegistrationFields,
  coggins: extractCogginsFields,
  health_cert: extractHealthCertFields,
  transfer: extractTransferFields,
  bill_of_sale: extractTransferFields,
  unknown: (text) => {
    const fields = {};
    const name = nameField(text, ['(?:horse\\s+)?name'], { maxLength: 60 });
    if (name) fields.name = name;
    return fields;
  },
};

// A document occasionally covers two horses (e.g. mare + foal registration).
// Count distinct horse-name captures so the pipeline can force a manual
// "assign or create" decision instead of auto-creating a profile.
export function detectMultipleHorses(text) {
  // Flatten OCR line breaks the same way the field extractor does, so a name
  // label and its value that OCR split across lines are read as one.
  const source = String(text || '')
    .split(/\r\n?|\n/)
    .map(normalizeWhitespace)
    .filter(Boolean)
    .join(' ');
  const names = new Set();
  // Read each explicit horse-name label with the SAME separator-aware reader the
  // field extractor now uses. The naive `Label: <value>` scan this replaced could
  // not see "Registered Name | ALPHA" or a ruled blank, so a certificate carrying
  // two such names -- a mare and her foal -- read as a single horse. With names
  // now extractable but the detector still blind, a high-OCR document with only
  // one recognizable registration number would clear the auto-create threshold
  // and silently create only the first horse. The two must read names the same
  // way. Pinned by the "two separator-formatted names" pipeline test.
  const explicitPattern = "horse(?:['’]s)?\\s+name|registered\\s+name|animal\\s+name|name\\s+of\\s+horse";
  for (const match of source.matchAll(new RegExp(`\\b(?:${explicitPattern})\\b`, 'gi'))) {
    const value = labeledField(source.slice(match.index), explicitPattern)?.value?.toLowerCase();
    if (value) names.add(value);
  }

  const registrations = new Set();
  const regMatches = source.matchAll(/registration\s*(?:no|number|#)\.?\s*[:#-]?\s*([A-Z]{0,4}[\s-]?\d{4,10}[A-Z]?)/gi);
  for (const match of regMatches) {
    registrations.add(cleanValue(match[1], { uppercase: true }).replace(/\s+/g, ''));
  }

  return {
    multiple: names.size > 1 || registrations.size > 1,
    horseNames: [...names],
    registrationNumbers: [...registrations],
  };
}

export function extractDocument({ text, ocrConfidence = 1 }) {
  const classification = classifyDocumentType(text);
  const fields = EXTRACTORS[classification.type](text);
  const multiHorse = detectMultipleHorses(text);

  const confidences = Object.values(fields).map((field) => field.confidence);
  const fieldConfidence = confidences.length
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : 0;
  const overallConfidence = Number(
    (Math.min(1, Math.max(0, ocrConfidence)) * fieldConfidence * classification.confidence ** 0.5).toFixed(4),
  );

  const confidenceMap = {};
  const extractedData = {};
  const lowConfidenceFields = [];
  for (const [key, field] of Object.entries(fields)) {
    extractedData[key] = field.value;
    const scaled = Number((field.confidence * Math.min(1, Math.max(0, ocrConfidence))).toFixed(4));
    confidenceMap[key] = scaled;
    if (scaled < NEEDS_REVIEW_THRESHOLD) {
      lowConfidenceFields.push(key);
    }
  }

  const needsReview = overallConfidence < NEEDS_REVIEW_THRESHOLD || multiHorse.multiple || !Object.keys(fields).length;

  return {
    documentType: classification.type,
    documentTypeLabel: DOCUMENT_TYPE_LABELS[classification.type],
    typeConfidence: classification.confidence,
    extractedData,
    confidenceMap,
    overallConfidence,
    lowConfidenceFields,
    multiHorse,
    needsReview,
  };
}

function normalizeIdentity(value) {
  return String(value || '')
    .replace(/\s+/g, '')
    .toUpperCase();
}

function normalizeName(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Two identifiers conflict when both are present and differ. An absent value
// on either side is not a conflict — a Coggins with no registration number
// does not contradict a registration paper that has one.
function identitiesConflict(a, b) {
  return Boolean(a) && Boolean(b) && a !== b;
}

// Group a batch of extractions into horse profile candidates. A shared
// registration number or microchip is a strong identity and merges documents
// into one candidate. A shared *name* is the weakest signal and merges only
// when neither side carries a strong identifier the other contradicts —
// otherwise a sire and a foal that happen to share a name (or two different
// horses both read as "STAR") would collapse into one record. Any conflict —
// same name but different registration/microchip, or the same registration
// with a different microchip — is refused or flagged `ambiguous`, which keeps
// documents-bulk-upload from auto-attaching or auto-creating from it (it gates
// on `!ambiguous`), forcing a person to resolve the identity instead.
export function groupExtractionsIntoCandidates(extractions) {
  const candidates = [];

  const locate = (registration, microchip, name) => {
    // Strong identity wins first: a shared registration or microchip is the
    // same horse. A conflicting *other* strong id on that match is suspicious
    // rather than a different horse, so merge but flag for review.
    const strong = candidates.find(
      (candidate) =>
        (registration && candidate.registrationNumber === registration) ||
        (microchip && candidate.microchip === microchip),
    );
    if (strong) {
      const conflicted =
        identitiesConflict(registration, strong.registrationNumber) || identitiesConflict(microchip, strong.microchip);
      return { candidate: strong, conflicted };
    }

    const named = candidates.find((candidate) => name && candidate.name === name);
    if (named) {
      if (
        identitiesConflict(registration, named.registrationNumber) ||
        identitiesConflict(microchip, named.microchip)
      ) {
        // Same name, different identity: not the same horse. Refuse the merge
        // and flag the existing record so the collision surfaces for review.
        named.ambiguous = true;
        return { candidate: undefined, nameCollision: true };
      }
      return { candidate: named };
    }
    return { candidate: undefined };
  };

  for (const extraction of extractions) {
    const registration = normalizeIdentity(extraction.extractedData.registrationNumber);
    const microchip = normalizeIdentity(extraction.extractedData.microchip);
    const name = normalizeName(extraction.extractedData.name);

    const { candidate: match, conflicted, nameCollision } = locate(registration, microchip, name);
    let candidate = match;
    if (!candidate) {
      candidate = {
        registrationNumber: '',
        microchip: '',
        name: '',
        fields: {},
        confidenceMap: {},
        documentRefs: [],
        documentTypes: [],
        ambiguous: false,
        confidence: 0,
      };
      candidates.push(candidate);
    }
    // A conflicting strong id on a merge, or a name collision that forced a new
    // record, both mean the identity is not settled — never silently commit it.
    if (conflicted || nameCollision) candidate.ambiguous = true;

    candidate.documentRefs.push(extraction.ref);
    candidate.documentTypes.push(extraction.documentType);
    candidate.ambiguous = candidate.ambiguous || extraction.multiHorse.multiple;

    for (const [key, value] of Object.entries(extraction.extractedData)) {
      const confidence = extraction.confidenceMap[key] ?? 0;
      if (!(key in candidate.fields) || confidence > (candidate.confidenceMap[key] ?? 0)) {
        candidate.fields[key] = value;
        candidate.confidenceMap[key] = confidence;
      }
    }

    candidate.registrationNumber = normalizeIdentity(candidate.fields.registrationNumber);
    candidate.microchip = normalizeIdentity(candidate.fields.microchip);
    candidate.name = normalizeName(candidate.fields.name);
    candidate.confidence = Math.max(candidate.confidence, extraction.overallConfidence);
  }

  return candidates;
}
