// Pure text → structured-field extraction for equine registration papers.
//
// Registration certificates (AQHA, APHA, Jockey Club, etc.) carry the facts a
// horse profile needs — registered name, registration number, sex, color,
// sire and dam with their own registration numbers — but OCR flattens the form
// into one noisy line of text. This module turns that text back into fields.
//
// It is deliberately dependency-free (no browser, no tesseract) so it can be
// unit tested directly and reused anywhere. The browser OCR/PDF plumbing lives
// in documentIntelligence.ts and hands its output here.
import type { HorseSex } from '../types/xbar.js';

export interface RegistrationFields {
  horseName?: string;
  registrationNumber?: string;
  registry?: string;
  sex?: HorseSex;
  color?: string;
  breed?: string;
  foaledOn?: string;
  sire?: string;
  sireRegistration?: string;
  dam?: string;
  damRegistration?: string;
  ownerName?: string;
}

// Registry bodies whose presence identifies the paper and whose codes prefix
// registration numbers. Longest-first so "APHC" wins over "AHA" etc.
const REGISTRIES = ['AQHA', 'APHA', 'ApHC', 'APHC', 'JC', 'USEF', 'AHA', 'ABRA', 'PtHA', 'IBHA', 'PHBA', 'APHASSOC'];

// Known coat colors, longest phrases first so "blue roan" beats "roan" and
// "red dun" beats "dun". Matched case-insensitively as whole words.
const COLORS = [
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

function parentLabel(label: 'sire' | 'dam') {
  return `${label}(?:['’]s)?(?:\\s+name)?|name\\s+of\\s+${label}`;
}

// Label tokens that mark the start of the *next* field. A captured value stops
// when one of these appears, so "Sire: SHINING SPARK Dam: ..." splits cleanly.
const STOP_LABELS = [
  'registered\\s+name',
  'name\\s+of\\s+horse',
  'horse\\s+name',
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
  'number',
];

const STOP_GROUP = STOP_LABELS.join('|');
const SEX_VALUE = '(?:gelding|stallion|stud|colt|filly|mare)';
const COLOR_VALUE = `(?:${COLORS.map((color) => color.replace(/[-\s]/g, '[-\\s]')).join('|')})`;

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

// Remove field dividers and scan rules, preserving attached punctuation such
// as *RAFFLES, -STAR, quoted names and apostrophes. A single dot or dash is a
// divider only when followed by whitespace; repeated runs represent rules.
const LEADING_SEPARATORS = /^(?:(?:[|;,:#=\u2022\u00b7]+|[_.\-\u2013\u2014~]{2,}|[_.\-\u2013\u2014~](?=\s))\s*)+/;

function cleanFieldValue(value: string | undefined): string | undefined {
  return value
    ?.trim()
    .replace(LEADING_SEPARATORS, '')
    .replace(/[|;,:_.\-\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Capture the text that follows a label, up to (but not including) the next
 * known field label or the end of the string.
 */
interface LabeledField {
  value: string;
  start: number;
  end: number;
}

function labeledField(text: string, labelPattern: string, stopGroup = STOP_GROUP): LabeledField | undefined {
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
  const ruled = /^\s*[:#]?\s*(?:[|;=\u2022\u00b7]+|[_.\-\u2013\u2014~]{2,})/.test(rawRemainder);
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

function labeledValue(text: string, labelPattern: string, stopGroup = STOP_GROUP): string | undefined {
  return labeledField(text, labelPattern, stopGroup)?.value;
}

/** Registry-prefixed or bare registration number, e.g. "AQHA 5551234" or "X0123456". */
function findRegistrationNumber(text: string): { number?: string; registry?: string } {
  // Labeled form keeps whatever token follows the label, so "AQHA1234567" is
  // preserved whole while a bare "5551234" stays numeric.
  const labeled = text.match(
    /\b(?:registration|reg\.?)\s*(?:no|number|#)?\.?\s*[:#-]?\s*([A-Z]{0,5}\s*-?\s*\d[\d\s-]{3,12}\d[A-Z]?)/i,
  );
  if (labeled) {
    const raw = labeled[1].replace(/[\s-]/g, '').toUpperCase();
    const prefix = raw.match(/^[A-Z]{2,5}/)?.[0];
    const registry = prefix && REGISTRIES.map((r) => r.toUpperCase()).includes(prefix) ? prefix : undefined;
    // Keep the registration number registry-free; the registry is its own field.
    return { number: registry ? raw.slice(registry.length) : raw, registry };
  }

  const registryGroup = REGISTRIES.join('|');
  const prefixed = text.match(new RegExp(`\\b(${registryGroup})\\s*[:#-]?\\s*(\\d[\\d\\s-]{4,12}\\d)`, 'i'));
  if (prefixed) {
    return { registry: prefixed[1].toUpperCase(), number: prefixed[2].replace(/[\s-]/g, '') };
  }
  return {};
}

function mapSex(raw: string | undefined): HorseSex | undefined {
  if (!raw) return undefined;
  const value = raw.toLowerCase();
  if (/\bgeld/.test(value)) return 'Gelding';
  if (/\b(stallion|stud)\b/.test(value)) return 'Stud';
  if (/\bcolt\b/.test(value)) return 'Colt';
  if (/\bfill/.test(value)) return 'Filly';
  if (/\bmare\b/.test(value)) return 'Mare';
  return undefined;
}

function findSex(text: string): HorseSex | undefined {
  const labeled = mapSex(labeledValue(text, 'sex|gender'));
  if (labeled) return labeled;
  // Fall back to any sex word anywhere in the document.
  return mapSex(text.match(/\b(gelding|stallion|stud|colt|filly|mare)\b/i)?.[0]);
}

function findColor(text: string): string | undefined {
  const labeled = labeledValue(text, 'colou?r');
  if (labeled) {
    const known = COLORS.find((color) => new RegExp(`\\b${color.replace(/[-\s]/g, '[-\\s]')}\\b`, 'i').test(labeled));
    const value = known ?? labeled.split(/\s+/).slice(0, 2).join(' ');
    return titleCase(value);
  }
  const found = COLORS.find((color) => new RegExp(`\\b${color.replace(/[-\s]/g, '[-\\s]')}\\b`, 'i').test(text));
  return found ? titleCase(found) : undefined;
}

function findFoaledOn(text: string): string | undefined {
  const labeled = labeledValue(text, 'foaled|foaling|date\\s+foaled|foal\\s+date|born|birth\\s*date');
  const source = labeled ?? text;
  const iso = source.match(/\b(20\d{2}|19\d{2})-(\d{1,2})-(\d{1,2})\b/);
  if (iso) return `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`;
  const us = source.match(/\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b/);
  if (us) {
    const year = us[3].length === 2 ? `20${us[3]}` : us[3];
    return `${year}-${pad(us[1])}-${pad(us[2])}`;
  }
  return undefined;
}

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

/** A sire/dam entry: the parent's name plus, when present, its registration number. */
function findParent(text: string, label: 'sire' | 'dam'): { name?: string; registration?: string } {
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
    .replace(/[|;,:#.\-\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { name: name.length >= 2 ? name : undefined, registration };
}

function findRegistry(text: string, fallback?: string): string | undefined {
  const found = REGISTRIES.find((registry) => new RegExp(`\\b${registry}\\b`, 'i').test(text));
  return found ? found.toUpperCase() : fallback;
}

function findHorseNames(text: string, lineStarts: Set<number>): LabeledField[] {
  // Keep candidates until the parent boundary is known. An explicit name in
  // the sire section must not displace the horse's earlier bare Name field.
  const candidates: LabeledField[] = [];
  const explicitPattern = 'registered\\s+name|name\\s+of\\s+horse|horse\\s+name';
  for (const match of text.matchAll(new RegExp(`\\b(?:${explicitPattern})\\b`, 'ig'))) {
    const field = labeledField(text.slice(match.index), explicitPattern);
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
    const field = labeledField(text.slice(match.index), 'name');
    if (field) candidates.push({ ...field, start: field.start + match.index, end: field.end + match.index });
  }
  return candidates;
}

function pad(value: string) {
  return value.padStart(2, '0');
}

function titleCase(value: string) {
  return value.replace(/\b\w/g, (char) => char.toUpperCase());
}

/**
 * Extract every field a registration paper can supply from raw (OCR'd) text.
 * The horse's own registration number is read from the text *above* the first
 * "sire"/"dam" label so it is never confused with a parent's number.
 */
export function extractRegistrationFields(rawText: string): RegistrationFields {
  // Retain line starts while flattening OCR whitespace. A bare Name below a
  // certificate heading is a field; Association Name on one line is not.
  const lines = rawText
    .split(/\r\n?|\n/)
    .map(normalizeWhitespace)
    .filter(Boolean);
  const lineStarts = new Set<number>();
  let offset = 0;
  lines.forEach((line, index) => {
    /*
     * A line start normally means "this is a field of its own", which is what
     * lets a bare `Name:` under a certificate heading be the horse's name.
     *
     * It must NOT do so when OCR has split a qualified label across the break:
     * "Association / Name: AQHA" is one label, and treating the second line as
     * a field names the horse after the association. The distinguishing signal
     * is that the previous line is the qualifier and NOTHING else -- real
     * letterhead reads "Blue River Farm", never a naked "Farm" -- so only a
     * bare qualifier line withholds the free pass.
     */
    const previous = index > 0 ? lines[index - 1] : undefined;
    const splitQualifiedLabel = previous !== undefined && QUALIFIER_ONLY_LINE.test(previous);
    if (!splitQualifiedLabel) lineStarts.add(offset);
    offset += line.length + 1;
  });
  const text = lines.join(' ');
  if (!text) return {};

  const horseNames = findHorseNames(text, lineStarts);
  // A labeled name such as DAM GOOD contains data, not a parent-field label.
  const parentIndex =
    [...text.matchAll(new RegExp(`\\b(?:${parentLabel('sire')}|${parentLabel('dam')})\\b`, 'ig'))].find(
      (match) => !horseNames.some((name) => match.index >= name.start && match.index < name.end),
    )?.index ?? -1;
  const headText = parentIndex >= 0 ? text.slice(0, parentIndex) : text;
  const parentText = parentIndex >= 0 ? text.slice(parentIndex) : '';
  const horseName = horseNames.find((name) => parentIndex < 0 || name.start < parentIndex);

  const own = findRegistrationNumber(headText);
  const sire = findParent(parentText, 'sire');
  const dam = findParent(parentText, 'dam');

  const fields: RegistrationFields = {
    horseName: horseName?.value,
    registrationNumber: own.number,
    registry: findRegistry(text, own.registry),
    sex: findSex(text),
    color: findColor(text),
    breed: labeledValue(text, 'breed'),
    foaledOn: findFoaledOn(text),
    sire: sire.name,
    sireRegistration: sire.registration,
    dam: dam.name,
    damRegistration: dam.registration,
    ownerName: labeledValue(text, OWNER_LABELS),
  };

  // Drop empty keys so callers can use `?? fallback` cleanly.
  (Object.keys(fields) as (keyof RegistrationFields)[]).forEach((key) => {
    if (!fields[key]) delete fields[key];
  });
  return fields;
}
