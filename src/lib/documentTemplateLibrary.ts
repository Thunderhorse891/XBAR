import type { DocumentRecord, HorseRecord, OwnershipRecord, SubscriptionTier, WorkspaceProfile } from '@/types/xbar';

export type DocumentTemplateTier = 'Basic' | 'Pro' | 'Business';

export type DocumentTemplateId =
  | 'bill-of-sale'
  | 'boarding-agreement'
  | 'lease-agreement'
  | 'veterinary-care-log'
  | 'coggins-health-certificate'
  | 'breeding-contract'
  | 'training-agreement'
  | 'foaling-mare-record'
  | 'sales-packet'
  | 'client-onboarding'
  | 'professional-services-agreement'
  | 'release-liability-waiver'
  | 'multi-owner-transfer'
  | 'branded-barn-asset-pack'
  | 'vet-invoice-payment-plan';

export type DocumentTemplate = {
  id: DocumentTemplateId;
  tier: DocumentTemplateTier;
  label: string;
  purpose: string;
  minimumPlan: SubscriptionTier;
};

export type PrefilledDocument = {
  template: DocumentTemplate;
  title: string;
  fileName: string;
  summary: string;
  html: string;
  plainText: string;
  missingFields: string[];
};

export const documentTemplateLibrary: DocumentTemplate[] = [
  { id: 'bill-of-sale', tier: 'Basic', label: 'Bill of Sale / Purchase Agreement', purpose: 'Horse sale terms, purchase price, seller, buyer, horse identity, and transfer details.', minimumPlan: 'Starter' },
  { id: 'boarding-agreement', tier: 'Basic', label: 'Standard Boarding Agreement', purpose: 'Stabling terms, care responsibilities, fees, emergency contact, and barn policies.', minimumPlan: 'Starter' },
  { id: 'lease-agreement', tier: 'Basic', label: 'Lessee & Lease Agreement', purpose: 'Lease duration, permitted use, payment terms, care duties, and return conditions.', minimumPlan: 'Starter' },
  { id: 'veterinary-care-log', tier: 'Basic', label: 'Veterinary Care Log', purpose: 'Vet visits, diagnoses, treatment notes, medication history, and follow-up dates.', minimumPlan: 'Starter' },
  { id: 'coggins-health-certificate', tier: 'Basic', label: 'Coggins & Health Certificate Form', purpose: 'Pre-filled horse and owner fields for annual testing and travel health paperwork.', minimumPlan: 'Starter' },
  { id: 'breeding-contract', tier: 'Pro', label: 'Breeding Contract', purpose: 'Mare owner, stallion owner, stud fee, live foal guarantee, breeding method, and rebreed terms.', minimumPlan: 'Professional' },
  { id: 'training-agreement', tier: 'Pro', label: 'Training Agreement', purpose: 'Training scope, fees, show goals, liability terms, client responsibilities, and care permissions.', minimumPlan: 'Professional' },
  { id: 'foaling-mare-record', tier: 'Pro', label: 'Foaling & Mare Record', purpose: 'Cycle notes, breeding dates, pregnancy checks, foaling observations, and birth record.', minimumPlan: 'Professional' },
  { id: 'sales-packet', tier: 'Pro', label: 'Sales Packet', purpose: 'Branded buyer-ready packet with horse profile, sale details, ownership, medical, Coggins, and verified documents.', minimumPlan: 'Professional' },
  { id: 'client-onboarding', tier: 'Pro', label: 'Client Onboarding Form', purpose: 'New client intake, emergency contacts, horse details, care instructions, and service expectations.', minimumPlan: 'Professional' },
  { id: 'professional-services-agreement', tier: 'Business', label: 'Professional Services Agreement', purpose: 'Farrier, vet, bodyworker, clinician, or contractor service terms for a barn operation.', minimumPlan: 'Ranch Ops' },
  { id: 'release-liability-waiver', tier: 'Business', label: 'Release of Liability & Waiver', purpose: 'Lesson, training, handling, boarding, clinic, and visitor risk acknowledgement workflow.', minimumPlan: 'Ranch Ops' },
  { id: 'multi-owner-transfer', tier: 'Business', label: 'Multi-Owner Transfer Forms', purpose: 'Shared ownership, syndicate, co-owner, managing partner, and percentage transfer details.', minimumPlan: 'Ranch Ops' },
  { id: 'branded-barn-asset-pack', tier: 'Business', label: 'Branded Barn Asset Pack', purpose: 'Boarding agreements, emergency protocols, insurance references, and barn policy packet.', minimumPlan: 'Ranch Ops' },
  { id: 'vet-invoice-payment-plan', tier: 'Business', label: 'Vet Invoice & Payment Plan Templates', purpose: 'Procedure invoice structure, payment schedule, responsible party, and care ledger attachment.', minimumPlan: 'Ranch Ops' },
];

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cleanFileName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'xbar-document';
}

function latestDocument(documents: DocumentRecord[], type: DocumentRecord['type']) {
  return documents
    .filter((document) => document.type === type)
    .sort((left, right) => Date.parse(right.entities.examDate ?? right.uploadedAt) - Date.parse(left.entities.examDate ?? left.uploadedAt))[0];
}

function valueOrBlank(value?: string | number) {
  if (value === undefined || value === null || value === '') return '________________';
  return String(value);
}

function findMissing(label: string, value?: string | number) {
  return value === undefined || value === null || value === '' ? [label] : [];
}

function fieldRow(label: string, value?: string | number) {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(valueOrBlank(value))}</td></tr>`;
}

function section(title: string, rows: string[]) {
  return `<section><h2>${escapeHtml(title)}</h2><table>${rows.join('')}</table></section>`;
}

function bulletList(items: string[]) {
  return `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

export function buildPrefilledDocument(params: {
  templateId: DocumentTemplateId;
  horse: HorseRecord;
  workspaceProfile: WorkspaceProfile;
  documents: DocumentRecord[];
  ownershipRecord?: OwnershipRecord;
  generatedBy?: string;
  sharedLink?: string;
  now?: Date;
}): PrefilledDocument {
  const template = documentTemplateLibrary.find((item) => item.id === params.templateId) ?? documentTemplateLibrary[0];
  const now = params.now ?? new Date();
  const horseDocuments = params.documents.filter((document) => document.horseId === params.horse.id && document.state === 'Ready');
  const coggins = latestDocument(horseDocuments, 'Coggins');
  const billOfSale = latestDocument(horseDocuments, 'Bill of Sale');
  const transfer = latestDocument(horseDocuments, 'Transfer Packet');
  const breedingContract = latestDocument(horseDocuments, 'Breeding Contract');
  const vetRecords = horseDocuments.filter((document) => document.type === 'Vet Record' || document.type === 'Coggins');
  const missingFields = [
    ...findMissing('horse name', params.horse.name),
    ...findMissing('owner', params.horse.owner),
    ...findMissing('registration number', params.horse.registrationNumber || params.horse.aqhaNumber),
    ...findMissing('microchip', params.horse.microchipId),
    ...(template.id === 'sales-packet' && !coggins ? ['approved Coggins document'] : []),
  ];

  const title = `${template.label} — ${params.horse.name}`;
  const generatedAt = now.toISOString().slice(0, 10);
  const identityRows = [
    fieldRow('Horse name', params.horse.name),
    fieldRow('Barn name', params.horse.barnName),
    fieldRow('Breed', params.horse.breed),
    fieldRow('Age', params.horse.age),
    fieldRow('Foaled', params.horse.foaledOn),
    fieldRow('Sex', params.horse.sex),
    fieldRow('Color', params.horse.color),
    fieldRow('Markings', params.horse.markings),
    fieldRow('Registry', params.horse.registry),
    fieldRow('Registration number', params.horse.registrationNumber || params.horse.aqhaNumber),
    fieldRow('Microchip', params.horse.microchipId),
  ];
  const ownerRows = [
    fieldRow('Legal owner', params.ownershipRecord?.legalOwner || params.horse.owner),
    fieldRow('Owner entity', params.horse.ownerEntity || params.workspaceProfile.defaultOwnerEntity),
    fieldRow('Ranch / barn', params.workspaceProfile.ranchName),
    fieldRow('Business', params.workspaceProfile.businessName),
    fieldRow('Ranch manager', params.workspaceProfile.ranchManagerName),
    fieldRow('Operations email', params.workspaceProfile.operationsEmail),
  ];
  const healthRows = [
    fieldRow('Last vet visit', params.horse.lastVetVisit),
    fieldRow('Veterinarian', params.horse.assignments.veterinarian),
    fieldRow('Farrier', params.horse.assignments.farrier),
    fieldRow('Coggins date', coggins?.entities.examDate ?? coggins?.uploadedAt),
    fieldRow('Medical notes', params.horse.medicalNotes),
  ];
  const saleRows = [
    fieldRow('Ask price', params.horse.sale.askPrice ? `$${params.horse.sale.askPrice.toLocaleString()}` : undefined),
    fieldRow('Sale readiness score', `${params.horse.readiness.score}%`),
    fieldRow('Packet status', params.horse.readiness.packetStatus),
    fieldRow('Buyer confidence', `${params.horse.sale.buyerConfidence}%`),
    fieldRow('Public/private share link', params.sharedLink),
  ];
  const documentRows = horseDocuments.length
    ? horseDocuments.map((document) => fieldRow(document.type, `${document.title} · ${document.uploadedAt}`))
    : [fieldRow('Approved records', undefined)];

  const templateSpecific = {
    'bill-of-sale': [section('Sale terms', [...saleRows, fieldRow('Buyer name'), fieldRow('Deposit'), fieldRow('Final payment due'), fieldRow('Possession transfer date')])],
    'boarding-agreement': [section('Boarding terms', [fieldRow('Monthly board'), fieldRow('Facility location', params.horse.location.barn), fieldRow('Care package'), fieldRow('Emergency authority')])],
    'lease-agreement': [section('Lease terms', [fieldRow('Lessee'), fieldRow('Lease start'), fieldRow('Lease end'), fieldRow('Monthly lease fee'), fieldRow('Permitted use')])],
    'veterinary-care-log': [section('Care log', healthRows), section('Recent medical timeline', params.horse.medicalTimeline.slice(0, 8).map((event) => fieldRow(event.date, `${event.title}: ${event.summary}`)))],
    'coggins-health-certificate': [section('Vet-ready fields', healthRows), section('Certificate notes', [fieldRow('Testing veterinarian'), fieldRow('Destination'), fieldRow('Travel date')])],
    'breeding-contract': [section('Breeding terms', [fieldRow('Mare', params.horse.sex === 'Mare' ? params.horse.name : undefined), fieldRow('Stallion'), fieldRow('Stud fee'), fieldRow('Breeding method'), fieldRow('Live foal guarantee'), fieldRow('Existing contract', breedingContract?.title)])],
    'training-agreement': [section('Training terms', [fieldRow('Trainer', params.horse.assignments.trainer), fieldRow('Training start'), fieldRow('Monthly training fee'), fieldRow('Competition goals'), fieldRow('Care permissions')])],
    'foaling-mare-record': [section('Mare and foaling record', [fieldRow('Mare', params.horse.name), fieldRow('Cycle notes'), fieldRow('Breeding date'), fieldRow('Pregnancy check'), fieldRow('Foaling date'), fieldRow('Complications')])],
    'sales-packet': [section('Sale summary', saleRows), section('Verified packet documents', documentRows), section('Source documents', [fieldRow('Bill of Sale', billOfSale?.title), fieldRow('Transfer packet', transfer?.title), fieldRow('Coggins', coggins?.title), fieldRow('Vet records', vetRecords.length)])],
    'client-onboarding': [section('Client intake', [fieldRow('Client name'), fieldRow('Emergency contact'), fieldRow('Care instructions'), fieldRow('Authorized services'), fieldRow('Billing email')])],
    'professional-services-agreement': [section('Service terms', [fieldRow('Service provider'), fieldRow('Service type'), fieldRow('Rate'), fieldRow('Insurance reference'), fieldRow('Scheduling contact', params.workspaceProfile.operationsEmail)])],
    'release-liability-waiver': [section('Risk acknowledgement', [fieldRow('Participant'), fieldRow('Activity'), fieldRow('Horse', params.horse.name), fieldRow('Emergency contact'), fieldRow('Signature date')])],
    'multi-owner-transfer': [section('Ownership transfer', [fieldRow('Current owner', params.horse.owner), fieldRow('Owner entity', params.horse.ownerEntity), fieldRow('Transfer status', params.ownershipRecord?.transferStatus), fieldRow('Pending documents', params.ownershipRecord?.pendingDocuments.join(', ')), fieldRow('Compliance deadline', params.ownershipRecord?.complianceDeadline)])],
    'branded-barn-asset-pack': [section('Barn asset packet', [fieldRow('Business', params.workspaceProfile.businessName), fieldRow('Ranch', params.workspaceProfile.ranchName), fieldRow('Default barn', params.workspaceProfile.defaultBarn), fieldRow('Emergency contact'), fieldRow('Insurance reference')])],
    'vet-invoice-payment-plan': [section('Invoice and payment plan', [fieldRow('Responsible party', params.horse.owner), fieldRow('Horse', params.horse.name), fieldRow('Procedure'), fieldRow('Total due'), fieldRow('Payment schedule'), fieldRow('Vet records attached', vetRecords.length)])],
  } satisfies Record<DocumentTemplateId, string[]>;

  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>body{font-family:Arial,sans-serif;margin:40px;color:#17202a}header{border-bottom:2px solid #17202a;margin-bottom:24px;padding-bottom:16px}h1{font-size:26px;margin:0 0 8px}h2{font-size:16px;margin-top:24px;text-transform:uppercase;letter-spacing:.08em}table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #d8dee6;padding:8px;text-align:left;vertical-align:top}th{width:32%;background:#f4f7fa}.notice{background:#fff8e5;border:1px solid #ead28a;padding:12px;margin:16px 0}.footer{margin-top:28px;color:#667;font-size:12px}</style></head><body><header><h1>${escapeHtml(title)}</h1><div>${escapeHtml(params.workspaceProfile.businessName || 'XBAR')} · Generated ${escapeHtml(generatedAt)} · ${escapeHtml(params.generatedBy || 'XBAR')}</div></header><div class="notice">Review all generated forms before signature. XBAR pre-fills operational data from the workspace; final legal language should be approved by the appropriate professional.</div>${section('Horse identity', identityRows)}${section('Owner and barn', ownerRows)}${templateSpecific[template.id].join('')}${section('Attached source records', documentRows)}${missingFields.length ? `<div class="notice"><strong>Missing before signature:</strong>${bulletList(missingFields)}</div>` : ''}<div class="footer">Generated by XBAR document library. Source records remain in the XBAR document vault.</div></body></html>`;

  const plainText = `${title}\nGenerated ${generatedAt}\n\nHorse: ${valueOrBlank(params.horse.name)}\nOwner: ${valueOrBlank(params.horse.owner)}\nRegistration: ${valueOrBlank(params.horse.registrationNumber || params.horse.aqhaNumber)}\nMicrochip: ${valueOrBlank(params.horse.microchipId)}\n\nMissing: ${missingFields.length ? missingFields.join(', ') : 'None flagged'}\n`;

  return {
    template,
    title,
    fileName: `${cleanFileName(template.label)}-${cleanFileName(params.horse.name)}.html`,
    summary: `${template.label} pre-filled for ${params.horse.name}. ${missingFields.length ? `${missingFields.length} fields need review.` : 'Ready for review.'}`,
    html,
    plainText,
    missingFields,
  };
}

export function downloadHtmlFile(fileName: string, html: string) {
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
