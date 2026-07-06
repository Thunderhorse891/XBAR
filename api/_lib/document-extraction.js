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

export function extractRegistrationFields(text) {
  const fields = {};
  const name = nameField(text, ['(?:horse\\s+)?name(?:\\s+of\\s+horse)?', 'registered\\s+name'], { maxLength: 60 });
  if (name) fields.name = name;

  const registration = captureField(
    text,
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

  const sire = nameField(text, ['sire'], { maxLength: 60 });
  if (sire) fields.sire = sire;

  const dam = nameField(text, ['dam'], { maxLength: 60 });
  if (dam) fields.dam = dam;

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
  const source = String(text || '');
  const names = new Set();
  const nameMatches = source.matchAll(
    new RegExp(`(?:horse|registered|animal)\\s+name\\s*[:#-]?\\s*${NAME_VALUE}`, 'gi'),
  );
  for (const match of nameMatches) {
    const value = cleanValue(match[1], { maxLength: 60 }).toLowerCase();
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

// Group a batch of extractions into horse profile candidates. Documents that
// share a registration number, microchip, or normalized horse name merge into
// a single candidate (e.g. Coggins + registration -> one horse record).
export function groupExtractionsIntoCandidates(extractions) {
  const candidates = [];

  const findCandidate = (extraction) => {
    const registration = normalizeIdentity(extraction.extractedData.registrationNumber);
    const microchip = normalizeIdentity(extraction.extractedData.microchip);
    const name = normalizeName(extraction.extractedData.name);

    return candidates.find((candidate) => {
      if (registration && candidate.registrationNumber === registration) return true;
      if (microchip && candidate.microchip === microchip) return true;
      if (name && candidate.name === name) return true;
      return false;
    });
  };

  for (const extraction of extractions) {
    let candidate = findCandidate(extraction);
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
