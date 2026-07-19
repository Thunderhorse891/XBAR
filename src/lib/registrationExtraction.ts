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
  'sire',
  'dam',
  'breeder',
  'owner',
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

function normalizeWhitespace(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Capture the text that follows a label, up to (but not including) the next
 * known field label or the end of the string.
 */
function labeledValue(text: string, labelPattern: string): string | undefined {
  const pattern = new RegExp(`\\b(?:${labelPattern})\\s*[:#.\\-]?\\s*(.+?)(?=\\s+(?:${STOP_GROUP})\\b|$)`, 'i');
  const match = text.match(pattern);
  const value = match?.[1]
    ?.replace(/[|;,:_.\-\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return value && value.length >= 2 ? value : undefined;
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
  'sire',
  'dam',
  'breeder',
  'owner',
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
  const pattern = new RegExp(`\\b${label}\\s*[:#.\\-]?\\s*(.+?)(?=\\s+(?:${PARENT_STOP_GROUP})\\b|$)`, 'i');
  const chunk = text
    .match(pattern)?.[1]
    ?.replace(/[|;,:_.\-\s]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
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

function findHorseName(text: string): string | undefined {
  const value = labeledValue(text, 'registered\\s+name|name\\s+of\\s+horse|horse\\s+name|name');
  if (!value) return undefined;
  // Guard against capturing "Name of Sire/Dam/Owner" style false positives.
  if (/^(?:of\s+)?(?:sire|dam|owner|breeder)\b/i.test(value)) return undefined;
  return value;
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
  const text = normalizeWhitespace(rawText);
  if (!text) return {};

  // Everything before the first parent label describes the horse itself.
  const parentIndex = text.search(/\b(?:sire|dam)\b/i);
  const headText = parentIndex > 0 ? text.slice(0, parentIndex) : text;

  const own = findRegistrationNumber(headText);
  const sire = findParent(text, 'sire');
  const dam = findParent(text, 'dam');

  const fields: RegistrationFields = {
    horseName: findHorseName(headText),
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
    ownerName: labeledValue(text, 'current\\s+owner|recorded\\s+owner|owner\\s+of\\s+record|owner'),
  };

  // Drop empty keys so callers can use `?? fallback` cleanly.
  (Object.keys(fields) as (keyof RegistrationFields)[]).forEach((key) => {
    if (!fields[key]) delete fields[key];
  });
  return fields;
}
