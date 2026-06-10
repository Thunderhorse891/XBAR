export type LegalDocumentId =
  | 'terms'
  | 'privacy'
  | 'subscription-billing'
  | 'equine-records-disclaimer'
  | 'trademark-notice'
  | 'acceptable-use';

export type LegalDocumentSection = {
  title: string;
  body: string[];
};

export type LegalDocument = {
  id: LegalDocumentId;
  title: string;
  shortTitle: string;
  purpose: string;
  lastUpdated: string;
  suggestedFileName: string;
  notice: string;
  sections: LegalDocumentSection[];
};

export const legalLastUpdated = 'June 10, 2026';

export const legalDocuments: LegalDocument[] = [
  {
    id: 'terms',
    title: 'XBAR LLC Terms of Service and SaaS Agreement',
    shortTitle: 'Terms of Service',
    purpose: 'Customer-facing agreement for account access, subscriptions, acceptable use, data ownership, disclaimers, and liability limits.',
    lastUpdated: legalLastUpdated,
    suggestedFileName: 'xbar-llc-terms-of-service-saas-agreement.html',
    notice: 'Operational baseline only. Have Texas counsel review before relying on this as the final customer agreement.',
    sections: [
      {
        title: '1. Acceptance of terms',
        body: [
          'These Terms of Service and SaaS Agreement govern access to and use of the XBAR LLC platform, websites, applications, document tools, buyer packet workflows, and related services. By creating an account, accessing a workspace, starting a subscription, or using the service, the user agrees to these terms.',
          'If a user accepts these terms on behalf of a ranch, barn, company, partnership, or other entity, that user represents that they have authority to bind that entity.',
        ],
      },
      {
        title: '2. Service description',
        body: [
          'XBAR LLC provides ranch and horse operation software for command files, proof control, title and transfer posture, care status, buyer movement, operating ledger workflows, document intake, and buyer packet preparation.',
          'The service is an operational records platform. It is not a law firm, veterinary practice, accounting firm, insurance agency, livestock broker, escrow service, registry authority, or payment processor.',
        ],
      },
      {
        title: '3. Account responsibilities',
        body: [
          'Users are responsible for maintaining accurate account information, protecting login credentials, controlling workspace access, and ensuring that invited users are authorized to view or modify ranch, horse, buyer, ownership, expense, and document records.',
          'Users are responsible for the accuracy, legality, completeness, and authorization status of all records, images, files, signatures, documents, buyer packets, and sale information uploaded or generated through XBAR.',
        ],
      },
      {
        title: '4. Subscriptions and payment',
        body: [
          'Paid plans are subscription services. Unless otherwise stated at checkout, subscriptions renew automatically on a recurring monthly basis until canceled. Stripe or another payment processor may process payments, invoices, billing portal access, taxes, and payment method handling.',
          'The user authorizes recurring charges for the selected plan and any approved add-ons, seats, storage, or usage-based charges. Cancellation stops future renewals but does not automatically refund prior charges or partial billing periods unless required by law or expressly stated in writing.',
        ],
      },
      {
        title: '5. Workspace data and ownership',
        body: [
          'The customer retains ownership of ranch, horse, document, buyer, ownership, medical, expense, and operational data entered into the service. XBAR LLC receives a limited license to host, process, transmit, display, secure, back up, and use that data as needed to provide and improve the service.',
          'Users should maintain independent copies of critical documents, including registration papers, Coggins records, veterinary records, bills of sale, transfer documents, contracts, insurance documents, and tax or accounting records.',
        ],
      },
      {
        title: '6. No professional advice',
        body: [
          'XBAR does not provide legal, veterinary, medical, tax, accounting, insurance, registry, appraisal, brokerage, or financial advice. Generated forms, templates, alerts, readiness scores, proof summaries, and buyer packet workflows are operational aids only.',
          'Users should consult qualified professionals before signing contracts, completing transfers, making veterinary decisions, selling horses, relying on tax treatment, making insurance decisions, or completing regulated transactions.',
        ],
      },
      {
        title: '7. Buyer packets and shared records',
        body: [
          'Buyer-facing profiles, sale packets, shared links, public packets, and generated documents contain information supplied, selected, approved, or released by the user. XBAR LLC does not independently verify horse identity, registration status, title, ownership, lien status, medical condition, genetic claims, show history, performance history, sale terms, or health records.',
          'Buyers, sellers, agents, owners, and third parties must independently verify all information before purchase, transfer, breeding, shipment, competition, insurance, or payment.',
        ],
      },
      {
        title: '8. Prohibited uses',
        body: [
          'Users may not use XBAR to upload forged records, misrepresent ownership, conceal liens, fabricate health or veterinary data, misrepresent horse condition, deceive buyers, facilitate fraud, violate registry rules, infringe intellectual property, harass users, or conduct unlawful activity.',
          'XBAR may suspend or terminate access for suspected misuse, fraud, security risk, non-payment, unlawful content, or violations of these terms.',
        ],
      },
      {
        title: '9. Availability and changes',
        body: [
          'The service may be updated, modified, interrupted, or discontinued. XBAR may change features, plans, storage limits, templates, integrations, and workflows to improve reliability, safety, security, or commercial viability.',
          'XBAR will make reasonable efforts to maintain service availability but does not guarantee uninterrupted, error-free, or permanent access to any feature or third-party integration.',
        ],
      },
      {
        title: '10. Limitation of liability',
        body: [
          'To the maximum extent permitted by law, XBAR LLC is not liable for lost profits, lost sales, horse injury, buyer disputes, registration issues, transfer disputes, veterinary decisions, inaccurate user data, third-party service failures, data loss, indirect damages, consequential damages, special damages, or punitive damages.',
          'To the maximum extent permitted by law, XBAR LLC total liability for claims arising from the service is limited to the amount paid by the customer to XBAR during the three months before the event giving rise to the claim.',
        ],
      },
      {
        title: '11. Governing law and venue',
        body: [
          'Unless a separate written agreement states otherwise, these terms are governed by the laws of the State of Texas, without regard to conflict-of-law rules.',
          'Venue and dispute language should be reviewed by counsel before final launch and may need to be revised for consumer, business, or multi-state customers.',
        ],
      },
      {
        title: '12. Contact',
        body: ['Questions about these terms may be directed to legal@xbar.app or the current customer support contact provided inside the XBAR workspace.'],
      },
    ],
  },
  {
    id: 'privacy',
    title: 'XBAR LLC Privacy Policy',
    shortTitle: 'Privacy Policy',
    purpose: 'Privacy notice covering account data, ranch records, documents, buyer links, payments, storage, retention, and third-party processors.',
    lastUpdated: legalLastUpdated,
    suggestedFileName: 'xbar-llc-privacy-policy.html',
    notice: 'Operational baseline only. Confirm final privacy obligations with counsel before public launch.',
    sections: [
      {
        title: '1. Information collected',
        body: [
          'XBAR may collect account information, user names, emails, workspace details, ranch profile data, horse records, ownership data, medical and care records, document files, media, receipts, expense records, buyer lead data, shared packet settings, device and usage information, and support communications.',
          'Payment card details are handled by payment processors such as Stripe. XBAR does not intentionally store full payment card numbers in the application database.',
        ],
      },
      {
        title: '2. How information is used',
        body: [
          'XBAR uses information to provide the service, authenticate users, sync workspaces, generate documents, organize proof records, create buyer packets, process subscriptions, provide support, improve reliability, prevent misuse, maintain security, and comply with legal obligations.',
          'XBAR does not sell ranch, horse, buyer, ownership, medical, or document data to advertisers.',
        ],
      },
      {
        title: '3. Documents and sensitive records',
        body: [
          'Uploaded documents may include registration records, bills of sale, Coggins records, veterinary records, transfer packets, contracts, receipts, images, insurance references, and other sensitive operational records. Users should upload only records they have authority to store and share.',
          'Shared buyer links may expose approved buyer-facing information to anyone with access to that link, depending on workspace settings and release controls.',
        ],
      },
      {
        title: '4. Third-party providers',
        body: [
          'XBAR may use service providers for hosting, authentication, database storage, object storage, payments, email, analytics, error monitoring, weather data, and document processing. These providers process data only as needed to operate the service.',
          'Examples may include Supabase, Stripe, Vercel, weather providers, email providers, and document processing services, depending on the workspace configuration.',
        ],
      },
      {
        title: '5. Data retention and deletion',
        body: [
          'Customer data is generally retained while the account or workspace is active and as needed for backups, legal obligations, security, billing, fraud prevention, and dispute resolution.',
          'Customers should export or back up critical records before deleting data, canceling service, or changing workspace ownership. Account deletion and workspace deletion workflows may take time to fully remove backups and system logs.',
        ],
      },
      {
        title: '6. Security',
        body: [
          'XBAR uses reasonable administrative, technical, and organizational safeguards to protect account and workspace data. No online system can be guaranteed completely secure.',
          'Users are responsible for protecting passwords, controlling workspace invitations, assigning appropriate roles, and promptly removing users who should no longer have access.',
        ],
      },
      {
        title: '7. Privacy requests',
        body: [
          'Users may request access, correction, export, or deletion of personal information where required by applicable law. Requests may require identity or authority verification.',
          'Privacy requests may be sent to privacy@xbar.app or the current privacy contact listed in the application.',
        ],
      },
    ],
  },
  {
    id: 'subscription-billing',
    title: 'XBAR LLC Subscription, Billing, Cancellation, and Refund Policy',
    shortTitle: 'Billing Policy',
    purpose: 'Commercial charging language for paid plans, recurring billing, cancellations, refunds, plan changes, taxes, and payment processors.',
    lastUpdated: legalLastUpdated,
    suggestedFileName: 'xbar-llc-subscription-billing-refund-policy.html',
    notice: 'Use this as billing transparency language and confirm refund rules before launch.',
    sections: [
      {
        title: '1. Paid subscription plans',
        body: [
          'XBAR offers paid subscription plans for ranch, barn, breeder, and horse operation workflows. Features, limits, seats, storage, templates, buyer packet tools, and advanced workflows may vary by plan.',
          'Current plan names and prices are displayed at checkout or in Plan Control. A user should review the plan before starting or changing a subscription.',
        ],
      },
      {
        title: '2. Automatic renewal',
        body: [
          'Unless otherwise stated at checkout, paid subscriptions renew automatically on a monthly basis until canceled. By subscribing, the customer authorizes recurring charges to the payment method on file.',
          'Failed payments may result in retry attempts, account notices, feature restrictions, workspace suspension, or cancellation.',
        ],
      },
      {
        title: '3. Cancellation',
        body: [
          'Customers may cancel future renewal through the billing portal or support workflow made available by XBAR. Cancellation does not remove the customer responsibility for charges already incurred.',
          'After cancellation, access may continue until the end of the active billing period unless otherwise stated in the checkout terms or required by law.',
        ],
      },
      {
        title: '4. Refunds',
        body: [
          'Unless required by law or separately agreed in writing, XBAR does not provide refunds or credits for partial months, unused features, inactive accounts, plan downgrades, unused storage, or failure to cancel before renewal.',
          'XBAR may issue discretionary credits or refunds case by case. Discretionary refunds do not create a continuing obligation to provide similar refunds in the future.',
        ],
      },
      {
        title: '5. Plan changes',
        body: [
          'Plan upgrades may take effect immediately. Plan downgrades may take effect at the next billing period or after usage is brought within lower-plan limits.',
          'Feature access may change when a plan changes. Customers should export or preserve important records before downgrading if a lower plan has fewer seats, storage, templates, buyer packets, or workflow features.',
        ],
      },
      {
        title: '6. Taxes and processors',
        body: [
          'Taxes, payment authorization, invoices, receipts, and payment method updates may be handled by Stripe or another payment processor. Processor terms and privacy notices may apply.',
          'Customers are responsible for applicable taxes, duties, bank charges, failed payment fees, chargebacks, and any amounts required by the selected subscription.',
        ],
      },
    ],
  },
  {
    id: 'equine-records-disclaimer',
    title: 'XBAR LLC Equine Records, Buyer Packet, and Professional Advice Disclaimer',
    shortTitle: 'Equine Disclaimer',
    purpose: 'Specific disclaimer for horse records, buyer packets, Coggins, veterinary data, title transfer, ownership claims, and generated documents.',
    lastUpdated: legalLastUpdated,
    suggestedFileName: 'xbar-llc-equine-records-buyer-packet-disclaimer.html',
    notice: 'This is a product disclaimer, not a substitute for transaction-specific contracts or professional advice.',
    sections: [
      {
        title: '1. User-supplied records',
        body: [
          'Horse records, buyer packets, sale information, medical notes, veterinary data, ownership fields, title records, documents, images, and generated summaries are supplied, uploaded, selected, or approved by users.',
          'XBAR LLC does not independently inspect horses, verify registry records, confirm lien status, validate veterinary conclusions, authenticate signatures, or guarantee that user-supplied records are complete or accurate.',
        ],
      },
      {
        title: '2. Buyer verification required',
        body: [
          'Buyer-facing packets are informational tools only. Buyers should independently verify registration, identity, ownership, liens, health status, Coggins, veterinary history, soundness, performance claims, breeding status, insurance status, possession, and sale terms before payment or transfer.',
          'No buyer should rely solely on an XBAR packet when making a purchase, breeding, transport, insurance, competition, or veterinary decision.',
        ],
      },
      {
        title: '3. No veterinary or emergency use',
        body: [
          'XBAR care status workflows, alerts, notes, and document summaries are not veterinary advice and are not emergency medical systems. For animal health concerns, users should contact a licensed veterinarian.',
          'XBAR does not replace official medical records, veterinary diagnosis, emergency response protocols, biosecurity procedures, or regulatory health paperwork.',
        ],
      },
      {
        title: '4. No legal or transfer advice',
        body: [
          'Title and transfer workflows are operational tracking tools only. XBAR does not determine legal ownership, lien priority, enforceability of contracts, registry eligibility, escrow status, or transfer validity.',
          'Users should consult appropriate counsel, registry authorities, lienholders, insurers, veterinarians, and transaction professionals before completing a sale or transfer.',
        ],
      },
      {
        title: '5. Generated documents',
        body: [
          'Generated documents, templates, packets, and pre-filled forms are drafting aids. Users must review all generated content before signing, sending, filing, or relying on it.',
          'Any signature, sale, lease, boarding agreement, waiver, breeding contract, training agreement, or transfer document should be reviewed for the specific transaction and jurisdiction.',
        ],
      },
    ],
  },
  {
    id: 'trademark-notice',
    title: 'XBAR LLC Trademark, Brand, and Attribution Notice',
    shortTitle: 'Trademark Notice',
    purpose: 'Trademark and brand notice for XBAR LLC, XBAR, product names, logo, app marks, and buyer packet attribution.',
    lastUpdated: legalLastUpdated,
    suggestedFileName: 'xbar-llc-trademark-brand-notice.html',
    notice: 'Use TM for unregistered marks. Do not use the registered trademark symbol unless registration is complete.',
    sections: [
      {
        title: '1. XBAR marks',
        body: [
          'XBAR LLC(TM), XBAR(TM), XBAR Command Infrastructure(TM), XBAR Proof Vault(TM), XBAR Command Files(TM), XBAR Buyer Packet(TM), the XBAR name, the XBAR logo, product names, service names, graphics, icons, and trade dress are trademarks, service marks, or brand identifiers of XBAR LLC unless otherwise stated.',
          'The TM symbol gives notice that XBAR claims trademark rights. The registered trademark symbol should not be used unless and until a mark is registered with the appropriate trademark office.',
        ],
      },
      {
        title: '2. No license without permission',
        body: [
          'Use of the XBAR name, logo, screenshots, product interface, buyer packet marks, marketing copy, or brand assets does not grant ownership or a license except as expressly allowed in writing by XBAR LLC.',
          'Customers may reference XBAR as the software used to organize records or generate a packet, but may not imply partnership, endorsement, certification, registry approval, veterinary approval, or transaction verification by XBAR.',
        ],
      },
      {
        title: '3. Buyer packet attribution',
        body: [
          'Buyer packets, generated documents, and shared links may identify that they were generated using XBAR. That attribution does not mean XBAR verified the horse, seller, buyer, price, ownership, health, title, or transaction terms.',
          'XBAR may require attribution, watermarking, or source-record notices on certain generated documents, depending on the plan and release workflow.',
        ],
      },
      {
        title: '4. Third-party marks',
        body: [
          'Third-party names, registries, payment processors, hosting providers, veterinary bodies, breed associations, and product names belong to their respective owners. Reference to third-party marks does not imply endorsement or affiliation.',
        ],
      },
    ],
  },
  {
    id: 'acceptable-use',
    title: 'XBAR LLC Acceptable Use and Content Policy',
    shortTitle: 'Acceptable Use',
    purpose: 'Rules for uploads, buyer packets, records, misuse, fraud, account security, and prohibited content.',
    lastUpdated: legalLastUpdated,
    suggestedFileName: 'xbar-llc-acceptable-use-content-policy.html',
    notice: 'Operational baseline for account enforcement and content standards.',
    sections: [
      {
        title: '1. Accurate records',
        body: [
          'Users may not knowingly upload, create, approve, or share false, forged, altered, misleading, unauthorized, or incomplete records intended to deceive buyers, owners, registries, veterinarians, insurers, lenders, courts, tax authorities, or other third parties.',
          'Users must not use XBAR to misrepresent horse identity, registration, parentage, medical condition, ownership, liens, sale status, or buyer packet readiness.',
        ],
      },
      {
        title: '2. Authorized content only',
        body: [
          'Users should upload only documents, images, records, and personal information they have the right to store, process, and share. This includes buyer information, owner information, veterinary documents, contracts, signatures, and financial records.',
          'Users are responsible for removing access when a team member, buyer, contractor, or third party should no longer view a workspace or packet.',
        ],
      },
      {
        title: '3. Prohibited activity',
        body: [
          'Users may not use the service for fraud, harassment, unlawful activity, malware, scraping, credential sharing, unauthorized access, abusive automation, infringement, privacy violations, chargeback abuse, or attempts to bypass plan limits or security controls.',
          'XBAR may investigate, restrict, suspend, or terminate accounts that appear to create legal, security, fraud, animal welfare, payment, or platform risk.',
        ],
      },
      {
        title: '4. Shared links and public content',
        body: [
          'Users are responsible for reviewing buyer-facing content before sharing any link. Public or token-based links may be forwarded beyond the original recipient.',
          'Sensitive internal notes, medical details, financial records, private owner information, and unverified documents should not be released unless the user has authority and a legitimate reason to share them.',
        ],
      },
    ],
  },
];

export const legalDocumentById: Record<LegalDocumentId, LegalDocument> = legalDocuments.reduce((accumulator, document) => {
  accumulator[document.id] = document;
  return accumulator;
}, {} as Record<LegalDocumentId, LegalDocument>);

export function getLegalDocument(id: LegalDocumentId) {
  return legalDocumentById[id];
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function legalDocumentToHtml(document: LegalDocument) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(document.title)}</title><style>body{font-family:Arial,sans-serif;margin:42px;color:#17202a;line-height:1.55}header{border-bottom:2px solid #17202a;margin-bottom:24px;padding-bottom:16px}h1{font-size:26px;margin:0 0 8px}h2{font-size:15px;margin-top:24px;text-transform:uppercase;letter-spacing:.08em}p{font-size:13px}.notice{background:#fff8e5;border:1px solid #ead28a;padding:12px;margin:16px 0}.footer{margin-top:28px;color:#667;font-size:12px;border-top:1px solid #d8dee6;padding-top:12px}</style></head><body><header><h1>${escapeHtml(document.title)}</h1><div>XBAR LLC(TM) · Last updated ${escapeHtml(document.lastUpdated)}</div></header><div class="notice"><strong>Review notice:</strong> ${escapeHtml(document.notice)}</div>${document.sections.map((section) => `<section><h2>${escapeHtml(section.title)}</h2>${section.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}</section>`).join('')}<div class="footer">XBAR LLC(TM). XBAR(TM) and related marks are trademarks or service marks claimed by XBAR LLC. This printable document is generated from the XBAR legal document library.</div></body></html>`;
}

export function openPrintableLegalDocument(document: LegalDocument) {
  const preview = window.open('', '_blank', 'noopener,noreferrer');
  if (!preview) return false;
  preview.document.write(legalDocumentToHtml(document));
  preview.document.close();
  preview.focus();
  return true;
}

export function downloadLegalHtml(document: LegalDocument) {
  const blob = new Blob([legalDocumentToHtml(document)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = document.suggestedFileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
