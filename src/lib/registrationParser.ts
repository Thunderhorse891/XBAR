import type { HorseSex } from '../types/xbar.js';

export interface RegistrationParseResult {
  horseName?: string;
  aqhaNumber?: string;
  breed?: string;
  color?: string;
  foaledOn?: string;
  sex?: HorseSex;
  height?: string;
  sire?: string;
  sireNumber?: string;
  dam?: string;
  damNumber?: string;
  owner?: string;
  confidence: number;
}

const COLORS = [
  'Red Roan', 'Blue Roan', 'Strawberry Roan',
  'Buckskin', 'Palomino', 'Grullo', 'Grulla',
  'Cremello', 'Perlino', 'Chestnut', 'Sorrel',
  'Black', 'Brown', 'White', 'Gray', 'Grey',
  'Overo', 'Tobiano', 'Bay', 'Dun', 'Roan',
];

const BREEDS = [
  'Quarter Horse', 'Paint Horse', 'Paint', 'Appaloosa',
  'Thoroughbred', 'Arabian', 'Morgan', 'Warmblood',
  'Tennessee Walker', 'Rocky Mountain Horse',
];

const MONTH_MAP: Record<string, string> = {
  january: '01', february: '02', march: '03', april: '04',
  may: '05', june: '06', july: '07', august: '08',
  september: '09', october: '10', november: '11', december: '12',
  jan: '01', feb: '02', mar: '03', apr: '04', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function parseDate(text: string): string | undefined {
  const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];

  const mdy = text.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-]((?:19|20)\d{2})\b/);
  if (mdy) {
    const [, m, d, y] = mdy;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  const named = text.match(/\b([A-Za-z]+)\s+(\d{1,2}),?\s+((?:19|20)\d{2})\b/);
  if (named) {
    const m = MONTH_MAP[named[1].toLowerCase()];
    if (m) return `${named[3]}-${m}-${named[2].padStart(2, '0')}`;
  }

  const dayFirst = text.match(/\b(\d{1,2})\s+([A-Za-z]+)\s+((?:19|20)\d{2})\b/);
  if (dayFirst) {
    const m = MONTH_MAP[dayFirst[2].toLowerCase()];
    if (m) return `${dayFirst[3]}-${m}-${dayFirst[1].padStart(2, '0')}`;
  }

  return undefined;
}

function parseAqhaNumber(text: string): string | undefined {
  const explicit = text.match(/(?:AQHA[#\s]*|Reg(?:istration)?\.?\s*[Nn]o\.?\s*[#\s]*)(\d{6,8})/i);
  if (explicit) return explicit[1];

  const hash = text.match(/#(\d{6,8})\b/);
  if (hash) return hash[1];

  const lineStart = text.match(/(?:^|\n)\s*(\d{7})\b/m);
  if (lineStart) return lineStart[1];

  return undefined;
}

function parseSireOrDam(text: string, label: 'sire' | 'dam'): { name?: string; number?: string } {
  const pattern = new RegExp(
    `\\b${label}[:\\s]+([A-Z][A-Z' N-]{2,40}?)(?:\\s+[#(]?(\\d{5,8})[)]?)?(?:\\n|$|[;,.])`,
    'im',
  );
  const match = text.match(pattern);
  if (!match?.[1]) return {};
  return { name: match[1].trim(), number: match[2]?.trim() };
}

export function parseRegistrationCertificate(text: string): RegistrationParseResult {
  const result: RegistrationParseResult = { confidence: 0 };
  let fieldsFound = 0;

  result.aqhaNumber = parseAqhaNumber(text);
  if (result.aqhaNumber) fieldsFound++;

  const namedMatch = text.match(/(?:registered\s+name|name)[:\s]+([A-Z][A-Z' N-]{2,40})/i);
  if (namedMatch) {
    result.horseName = namedMatch[1].trim();
    fieldsFound++;
  } else {
    const capsLines = Array.from(text.matchAll(/^([A-Z][A-Z' N-]{2,39})$/gm))
      .map((m) => m[1].trim())
      .filter((line) => line.split(' ').length <= 6 && line.length >= 3 && !/^\d/.test(line));
    if (capsLines[0]) {
      result.horseName = capsLines[0];
      fieldsFound++;
    }
  }

  for (const breed of BREEDS) {
    if (new RegExp(`\\b${breed.replace(/\s+/g, '\\s+')}\\b`, 'i').test(text)) {
      result.breed = breed;
      fieldsFound++;
      break;
    }
  }

  const colorLabeled = text.match(/\bcolor[:\s]+([A-Za-z\s]{2,25})(?:\n|,|;|\.)/i);
  const colorSource = colorLabeled ? colorLabeled[1] : text;
  for (const color of COLORS) {
    if (new RegExp(`\\b${color.replace(/\s+/g, '\\s+')}\\b`, 'i').test(colorSource)) {
      result.color = color;
      fieldsFound++;
      break;
    }
  }

  const foaledMatch = text.match(/(?:foaled?|date\s+of\s+birth|dob|born)[:\s]+([^\n]{4,30})/i);
  result.foaledOn = foaledMatch ? parseDate(foaledMatch[1]) : parseDate(text);
  if (result.foaledOn) fieldsFound++;

  const sexMatch = text.match(/\b(mare|stallion|gelding|filly|colt)\b/i);
  if (sexMatch) {
    const s = sexMatch[1].toLowerCase();
    result.sex = (s.charAt(0).toUpperCase() + s.slice(1)) as HorseSex;
    fieldsFound++;
  }

  const heightMatch = text.match(/\b(\d{1,2}(?:\.\d)?)\s*hh\b/i)
    ?? text.match(/\bheight[:\s]+(\d{1,2}(?:\.\d)?(?:\s*hh|\s*hands?)?)/i);
  if (heightMatch) {
    result.height = `${heightMatch[1].trim()}hh`;
    fieldsFound++;
  }

  const sire = parseSireOrDam(text, 'sire');
  if (sire.name) { result.sire = sire.name; result.sireNumber = sire.number; fieldsFound++; }

  const dam = parseSireOrDam(text, 'dam');
  if (dam.name) { result.dam = dam.name; result.damNumber = dam.number; fieldsFound++; }

  const ownerMatch = text.match(/(?:registered\s+owner|owner\s+of\s+record|owner)[:\s]+([A-Za-z][A-Za-z\s,.]{3,40})(?:\n|$)/i);
  if (ownerMatch) { result.owner = ownerMatch[1].trim(); fieldsFound++; }

  result.confidence = Math.min(0.95, 0.35 + fieldsFound * 0.06);
  return result;
}
