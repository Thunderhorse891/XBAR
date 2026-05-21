const fs = require('node:fs');
const path = require('node:path');

const storePath = path.join(__dirname, '..', 'src', 'store', 'useXbarStore.ts');
let source = fs.readFileSync(storePath, 'utf8');

source = source.replace(/\n  createNumericToken,\n/g, '\n');

const startMarker = 'function createHorseRecord(input: NewHorseInput, workspaceProfile: WorkspaceProfile): HorseRecord {';
const endMarker = '\nfunction guessHorseSexFromDocuments';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);

if (start === -1 || end === -1) {
  throw new Error('Unable to locate createHorseRecord block in src/store/useXbarStore.ts');
}

const lines = [
  'function createHorseRecord(input: NewHorseInput, workspaceProfile: WorkspaceProfile): HorseRecord {',
  "  const id = createId('horse');",
  '  const name = input.name.trim().toUpperCase();',
  '  const barnName = input.barnName.trim();',
  "  const ranchName = workspaceProfile.ranchName.trim() || 'Primary Ranch';",
  "  const ranchManagerName = workspaceProfile.ranchManagerName.trim() || 'Unassigned';",
  '  const operationsEmail = workspaceProfile.operationsEmail.trim();',
  "  const aqhaNumber = input.aqhaNumber?.trim() || '';",
  "  const registrationNumber = input.registrationNumber?.trim() || '';",
  '  const hasVerifiedRegistration = Boolean(aqhaNumber || registrationNumber);',
  '',
  '  return {',
  '    id,',
  '    name,',
  '    barnName,',
  '    summary: `${barnName} is a new XBAR horse record. Registry, value, medical, media, and packet details are pending verification.`,',
  '    segment: input.segment,',
  '    status: input.status,',
  "    breed: '',",
  "    registry: aqhaNumber ? 'AQHA' : '',",
  '    aqhaNumber,',
  '    registrationNumber,',
  '    registered: hasVerifiedRegistration,',
  '    age: 0,',
  "    foaledOn: '',",
  '    sex: input.sex,',
  "    color: '',",
  "    markings: '',",
  "    microchipId: '',",
  '    owner: input.owner.trim(),',
  '    ownerEntity: input.ownerEntity.trim(),',
  '    insuredValue: 0,',
  "    profileImage: '',",
  "    tags: ['new-intake', 'verification-needed', 'media-needed'],",
  '    bloodline: {',
  "      sire: '',",
  "      dam: '',",
  "      family: '',",
  '    },',
  '    location: {',
  '      ranch: ranchName,',
  '      barn: input.barn.trim(),',
  '      pasture: input.pasture.trim(),',
  "      stall: '',",
  '    },',
  '    assignments: {',
  "      trainer: '',",
  '      ranchManager: ranchManagerName,',
  "      veterinarian: '',",
  "      farrier: '',",
  '    },',
  '    ownership: [',
  '      {',
  "        id: createId('stake'),",
  '        name: input.owner.trim(),',
  '        share: 100,',
  "        role: 'Legal Owner',",
  '        contact: operationsEmail,',
  '      },',
  '    ],',
  '    gallery: [],',
  '    sale: {',
  "      listingState: 'Private',",
  '      askPrice: 0,',
  '      buyerConfidence: 0,',
  '      inquiryCount: 0,',
  '      watchlistCount: 0,',
  '      socialReady: false,',
  '    },',
  '    readiness: {',
  '      score: 0,',
  "      blockers: ['Registry not verified', 'Media not uploaded', 'Ownership packet not uploaded', 'Medical summary not reviewed'],",
  "      packetStatus: 'Needs Photos',",
  '    },',
  "    medicalNotes: '',",
  "    lastVetVisit: '',",
  '    documents: [],',
  '    medicalTimeline: [],',
  '    breedingTimeline: [],',
  '    activity: [',
  '      {',
  "        id: createId('activity'),",
  '        date: todayStamp(),',
  "        title: 'Horse record created',",
  "        summary: 'Initial horse profile created with only user-entered intake data. Verification fields remain blank until supported by documents or manual review.',",
  "        owner: 'Ops Desk',",
  "        category: 'Operations',",
  '      },',
  '    ],',
  '    documentFacts: [],',
  '    alerts: [',
  '      {',
  "        id: createId('alert'),",
  "        title: 'Verify intake data',",
  "        summary: 'Registry, age, value, medical, ownership, and media details must be verified before this record is buyer-ready.',",
  "        severity: 'medium',",
  "        module: 'Documents',",
  '      },',
  '    ],',
  '    notes: [],',
  '  };',
  '}',
  ''
];

source = source.slice(0, start) + lines.join('\n') + source.slice(end);

const forbidden = [
  'AQHA-${Date.now().toString().slice(-6)}',
  'microchipId: `9810${createNumericToken(10)}`',
  'insuredValue: 65000',
  'age: 4,',
  'Initial intake complete. Clinical review pending.'
];

for (const text of forbidden) {
  if (source.includes(text)) {
    throw new Error('Neutral intake enforcement failed; generated data still remains.');
  }
}

fs.writeFileSync(storePath, source, 'utf8');
console.log('Neutral horse intake enforcement complete.');
