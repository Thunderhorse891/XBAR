// Server-side template catalog mirroring src/lib/documentTemplateLibrary.ts.
// Each template is a structured section list so the same definition renders
// to HTML (frontend preview) and to PDF (api/_lib/pdf.js) without an HTML
// parser. Deployments can override a template by setting template_content
// (HTML with {{placeholders}}) on the document_templates row.

const SIGNATURE_LINES = [
  'Signature: ________________________________   Date: ______________',
  'Signature: ________________________________   Date: ______________',
];

const HORSE_IDENTITY_LINES = [
  'Horse name: {{horse.name}}',
  'Registration #: {{horse.registrationNumber}} ({{horse.registry}})',
  'Breed: {{horse.breed}}    Color: {{horse.color}}    Sex: {{horse.gender}}',
  'Foaled: {{horse.birthdate}}    Microchip: {{horse.microchip}}',
];

export const templateCatalog = [
  {
    id: 'bill-of-sale',
    name: 'Bill of Sale / Purchase Agreement',
    tier: 'Basic',
    minimumPlan: 'Starter',
    sections: [
      {
        heading: 'Parties',
        lines: [
          'Seller: {{owner.name}} ({{workspace.businessName}})',
          'Buyer: {{buyer.name}}',
          'Agreement date: {{today_date}}',
        ],
      },
      { heading: 'Horse', lines: HORSE_IDENTITY_LINES },
      {
        heading: 'Terms of Sale',
        lines: [
          'Purchase price: {{sale.price}}',
          'Deposit received: {{sale.deposit}}',
          'Balance due on or before: {{sale.balanceDueDate}}',
          'The horse is sold as-is. Risk of loss passes to the buyer upon delivery.',
        ],
      },
      { heading: 'Signatures', lines: SIGNATURE_LINES },
    ],
  },
  {
    id: 'boarding-agreement',
    name: 'Standard Boarding Agreement',
    tier: 'Basic',
    minimumPlan: 'Starter',
    sections: [
      {
        heading: 'Parties',
        lines: [
          'Facility: {{workspace.businessName}} ({{workspace.ranchName}})',
          'Horse owner: {{owner.name}}',
          'Start date: {{boarding.startDate}}',
        ],
      },
      { heading: 'Horse', lines: HORSE_IDENTITY_LINES },
      {
        heading: 'Boarding Terms',
        lines: [
          'Monthly board rate: {{boarding.monthlyRate}}',
          'Services included: stall, turnout, feed, water, routine observation.',
          'Emergency contact: {{owner.emergencyContact}}',
          'Owner authorizes emergency veterinary care up to: {{boarding.vetCareLimit}}',
        ],
      },
      { heading: 'Signatures', lines: SIGNATURE_LINES },
    ],
  },
  {
    id: 'lease-agreement',
    name: 'Lessee & Lease Agreement',
    tier: 'Basic',
    minimumPlan: 'Starter',
    sections: [
      {
        heading: 'Parties',
        lines: [
          'Lessor (owner): {{owner.name}}',
          'Lessee: {{lease.lesseeName}}',
          'Lease term: {{lease.startDate}} through {{lease.endDate}}',
        ],
      },
      { heading: 'Horse', lines: HORSE_IDENTITY_LINES },
      {
        heading: 'Lease Terms',
        lines: [
          'Monthly lease fee: {{lease.monthlyFee}}',
          'Permitted use: {{lease.permittedUse}}',
          'Lessee is responsible for routine care during the lease term.',
          'The horse must be returned in equal or better condition.',
        ],
      },
      { heading: 'Signatures', lines: SIGNATURE_LINES },
    ],
  },
  {
    id: 'veterinary-care-log',
    name: 'Veterinary Care Log',
    tier: 'Basic',
    minimumPlan: 'Starter',
    sections: [
      { heading: 'Horse', lines: HORSE_IDENTITY_LINES },
      { heading: 'Owner', lines: ['Owner: {{owner.name}}', 'Primary veterinarian: {{vet.name}}'] },
      {
        heading: 'Care Entries',
        lines: [
          'Date: __________  Visit type: __________  Vet: __________',
          'Diagnosis / treatment: ____________________________________________',
          'Medications: ____________________________________________________',
          'Follow-up due: __________',
        ],
      },
    ],
  },
  {
    id: 'coggins-health-certificate',
    name: 'Coggins & Health Certificate Form',
    tier: 'Basic',
    minimumPlan: 'Starter',
    sections: [
      { heading: 'Horse', lines: HORSE_IDENTITY_LINES },
      { heading: 'Owner', lines: ['Owner: {{owner.name}}', 'Facility: {{workspace.businessName}}'] },
      {
        heading: 'Coggins History',
        lines: [
          'Last Coggins test date: {{health.lastCogginsDate}}',
          'Next Coggins due: {{health.nextCogginsDue}}',
          'Last health certificate exam: {{health.lastExamDate}}',
        ],
      },
      {
        heading: 'For the Veterinarian',
        lines: [
          'Sample drawn date: __________  Lab: __________',
          'Result: __________  Accession #: __________',
          'Veterinarian signature: ________________________________',
        ],
      },
    ],
  },
  {
    id: 'breeding-contract',
    name: 'Breeding Contract',
    tier: 'Pro',
    minimumPlan: 'Professional',
    sections: [
      {
        heading: 'Parties',
        lines: [
          'Mare owner: {{owner.name}}',
          'Stallion owner: {{breeding.stallionOwner}}',
          'Contract date: {{today_date}}',
        ],
      },
      { heading: 'Mare', lines: HORSE_IDENTITY_LINES },
      {
        heading: 'Breeding Terms',
        lines: [
          'Stallion: {{breeding.stallionName}} (Reg # {{breeding.stallionRegistration}})',
          'Stud fee: {{breeding.studFee}}    Booking fee: {{breeding.bookingFee}}',
          'Method: {{breeding.method}}',
          'Live foal guarantee: {{breeding.liveFoalGuarantee}}',
          'Rebreed terms: {{breeding.rebreedTerms}}',
        ],
      },
      { heading: 'Signatures', lines: SIGNATURE_LINES },
    ],
  },
  {
    id: 'training-agreement',
    name: 'Training Agreement',
    tier: 'Pro',
    minimumPlan: 'Professional',
    sections: [
      {
        heading: 'Parties',
        lines: [
          'Trainer: {{workspace.businessName}}',
          'Client / owner: {{owner.name}}',
          'Start date: {{training.startDate}}',
        ],
      },
      { heading: 'Horse', lines: HORSE_IDENTITY_LINES },
      {
        heading: 'Training Terms',
        lines: [
          'Monthly training fee: {{training.monthlyFee}}',
          'Training goals: {{training.goals}}',
          'Owner grants permission for routine care decisions during training.',
          'Liability: owner acknowledges the inherent risk of equine activities.',
        ],
      },
      { heading: 'Signatures', lines: SIGNATURE_LINES },
    ],
  },
  {
    id: 'foaling-mare-record',
    name: 'Foaling & Mare Record',
    tier: 'Pro',
    minimumPlan: 'Professional',
    sections: [
      { heading: 'Mare', lines: HORSE_IDENTITY_LINES },
      {
        heading: 'Breeding Record',
        lines: [
          'Bred to: {{breeding.stallionName}}',
          'Last breeding date: {{breeding.lastBreedingDate}}',
          'Pregnancy check results: __________',
          'Expected foaling date: {{breeding.expectedFoalingDate}}',
        ],
      },
      {
        heading: 'Foaling Observations',
        lines: [
          'Foaling date/time: __________',
          'Foal sex: ______  Color/markings: __________________',
          'Notes: ____________________________________________________',
        ],
      },
    ],
  },
  {
    id: 'sales-packet',
    name: 'Sales Packet',
    tier: 'Pro',
    minimumPlan: 'Professional',
    sections: [
      {
        heading: 'Presented By',
        lines: [
          '{{workspace.businessName}} ({{workspace.ranchName}})',
          'Prepared for: {{buyer.name}}',
          'Prepared on: {{today_date}}',
        ],
      },
      { heading: 'Horse Profile', lines: HORSE_IDENTITY_LINES },
      {
        heading: 'Ownership & Compliance',
        lines: [
          'Legal owner: {{owner.name}}',
          'Last Coggins test: {{health.lastCogginsDate}}',
          'Registration status: {{horse.registrationNumber}}',
        ],
      },
      { heading: 'Included Documents', lines: ['{{packet.documentList}}'] },
    ],
  },
  {
    id: 'client-onboarding',
    name: 'Client Onboarding Form',
    tier: 'Pro',
    minimumPlan: 'Professional',
    sections: [
      {
        heading: 'Facility',
        lines: ['{{workspace.businessName}} ({{workspace.ranchName}})', 'Onboarding date: {{today_date}}'],
      },
      {
        heading: 'Client',
        lines: [
          'Client name: {{client.name}}',
          'Phone: {{client.phone}}    Email: {{client.email}}',
          'Emergency contact: {{client.emergencyContact}}',
        ],
      },
      { heading: 'Horse', lines: HORSE_IDENTITY_LINES },
      {
        heading: 'Care Instructions',
        lines: [
          'Feed program: ____________________________________________',
          'Medical notes: ___________________________________________',
          'Service expectations: ____________________________________',
        ],
      },
    ],
  },
  {
    id: 'professional-services-agreement',
    name: 'Professional Services Agreement',
    tier: 'Business',
    minimumPlan: 'Ranch Ops',
    sections: [
      {
        heading: 'Parties',
        lines: [
          'Barn operation: {{workspace.businessName}}',
          'Service provider: {{provider.name}}',
          'Service: {{provider.service}}',
          'Effective date: {{today_date}}',
        ],
      },
      {
        heading: 'Terms',
        lines: [
          'Scope of services: {{provider.scope}}',
          'Rate: {{provider.rate}}',
          'Insurance: provider carries professional liability coverage.',
          'Either party may terminate with 30 days written notice.',
        ],
      },
      { heading: 'Signatures', lines: SIGNATURE_LINES },
    ],
  },
  {
    id: 'release-liability-waiver',
    name: 'Release of Liability & Waiver',
    tier: 'Business',
    minimumPlan: 'Ranch Ops',
    sections: [
      { heading: 'Facility', lines: ['{{workspace.businessName}} ({{workspace.ranchName}})', 'Date: {{today_date}}'] },
      { heading: 'Participant', lines: ['Name: {{participant.name}}', 'Activity: {{participant.activity}}'] },
      {
        heading: 'Acknowledgement',
        lines: [
          'Under state equine activity liability law, an equine professional is not liable for injury or death resulting from the inherent risks of equine activities.',
          'The participant accepts these risks and releases the facility from liability for ordinary negligence.',
        ],
      },
      {
        heading: 'Signature',
        lines: ['Participant signature: ________________________________   Date: ______________'],
      },
    ],
  },
  {
    id: 'multi-owner-transfer',
    name: 'Multi-Owner Transfer Forms',
    tier: 'Business',
    minimumPlan: 'Ranch Ops',
    sections: [
      { heading: 'Horse', lines: HORSE_IDENTITY_LINES },
      {
        heading: 'Current Ownership',
        lines: ['Managing owner: {{owner.name}}', 'Co-owners and percentages: {{transfer.currentOwnership}}'],
      },
      {
        heading: 'Transfer',
        lines: [
          'New owner: {{transfer.newOwnerName}}',
          'Percentage transferred: {{transfer.percentage}}',
          'Effective date: {{transfer.effectiveDate}}',
          'Consideration: {{transfer.consideration}}',
        ],
      },
      { heading: 'Signatures', lines: ['Each owner of record must sign below.', ...SIGNATURE_LINES] },
    ],
  },
  {
    id: 'branded-barn-asset-pack',
    name: 'Branded Barn Asset Pack',
    tier: 'Business',
    minimumPlan: 'Ranch Ops',
    sections: [
      { heading: 'Barn', lines: ['{{workspace.businessName}} ({{workspace.ranchName}})', 'Generated: {{today_date}}'] },
      {
        heading: 'Included Assets',
        lines: [
          'Boarding agreement cover page',
          'Emergency protocol sheet',
          'Insurance reference card',
          'Barn policy packet',
        ],
      },
      {
        heading: 'Emergency Protocol',
        lines: [
          'Primary contact: {{workspace.ranchManagerName}}',
          'Operations email: {{workspace.operationsEmail}}',
          'Primary veterinarian: {{vet.name}}',
        ],
      },
    ],
  },
  {
    id: 'vet-invoice-payment-plan',
    name: 'Vet Invoice & Payment Plan Templates',
    tier: 'Business',
    minimumPlan: 'Ranch Ops',
    sections: [
      {
        heading: 'Invoice',
        lines: [
          'Veterinarian: {{vet.name}}',
          'Patient: {{horse.name}} (Reg # {{horse.registrationNumber}})',
          'Responsible party: {{owner.name}}',
          'Invoice date: {{today_date}}',
        ],
      },
      {
        heading: 'Charges',
        lines: [
          'Procedure: ____________________  Amount: __________',
          'Procedure: ____________________  Amount: __________',
          'Total due: {{invoice.total}}',
        ],
      },
      {
        heading: 'Payment Plan',
        lines: ['Installments: {{invoice.installments}}', 'First payment due: {{invoice.firstPaymentDate}}'],
      },
    ],
  },
];

export function getTemplateById(templateId) {
  return templateCatalog.find((template) => template.id === templateId) || null;
}

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

function lookupPlaceholder(context, key) {
  const parts = key.split('.');
  let current = context;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = current[part];
  }
  if (current == null) return undefined;
  const value = String(current).trim();
  return value || undefined;
}

export function renderPlaceholders(text, context, missingFields) {
  return String(text).replace(PLACEHOLDER_PATTERN, (_match, key) => {
    const value = lookupPlaceholder(context, key);
    if (value === undefined) {
      missingFields?.add(key);
      return '____________';
    }
    return value;
  });
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Renders a catalog template (or a DB template_content override) against a
// placeholder context. Returns parallel section/HTML/plain-text outputs plus
// the placeholders that had no value.
export function renderTemplate({ template, overrideContent = '', context }) {
  const missing = new Set();

  if (overrideContent.trim()) {
    const html = renderPlaceholders(overrideContent, context, missing);
    const text = html
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return {
      title: template.name,
      sections: [{ heading: template.name, lines: text ? [text] : [] }],
      html,
      text,
      missingFields: [...missing],
    };
  }

  const sections = template.sections.map((section) => ({
    heading: renderPlaceholders(section.heading, context, missing),
    lines: section.lines.map((line) => renderPlaceholders(line, context, missing)),
  }));

  const htmlSections = sections
    .map(
      (section) =>
        `<section><h2>${escapeHtml(section.heading)}</h2>${section.lines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</section>`,
    )
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(template.name)}</title></head><body><h1>${escapeHtml(template.name)}</h1>${htmlSections}</body></html>`;
  const text = sections.map((section) => `${section.heading}\n${section.lines.join('\n')}`).join('\n\n');

  return { title: template.name, sections, html, text, missingFields: [...missing] };
}
