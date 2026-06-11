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
    purpose: 'Customer-facing agreement for account access, subscriptions, data ownership, disclaimers, and liability limits.',
    lastUpdated: legalLastUpdated,
    suggestedFileName: 'xbar-llc-terms-of-service-saas-agreement.html',
    notice: 'Operational baseline only. Have counsel review before relying on this as the final customer agreement.',
    sections: [
      { title: 'Acceptance', body: ['These Terms govern access to and use of the XBAR LLC platform, applications, document tools, buyer packet workflows, and related services.', 'By creating an account, accessing a workspace, starting a subscription, or using the service, the user agrees to these Terms.'] },
      { title: 'Service description', body: ['XBAR LLC provides ranch and horse operation software for command files, proof control, title and transfer posture, care status, buyer movement, operating ledger workflows, document intake, and buyer packet preparation.', 'The service is an operational records platform. It is not a law firm, veterinary practice, accounting firm, insurance agency, livestock broker, escrow service, registry authority, or payment processor.'] },
      { title: 'Subscriptions and payment', body: ['Paid plans are subscription services. Unless otherwise stated at checkout, subscriptions renew automatically until canceled.', 'The user authorizes recurring charges for the selected plan and approved add-ons, seats, storage, or usage-based charges. Stripe or another payment processor may handle payment processing.'] },
      { title: 'Customer data', body: ['The customer retains ownership of ranch, horse, document, buyer, ownership, medical, expense, and operational data entered into the service.', 'XBAR LLC may host, process, transmit, display, secure, back up, and use that data as needed to provide and improve the service.'] },
      { title: 'No professional advice', body: ['XBAR does not provide legal, veterinary, medical, tax, accounting, insurance, registry, appraisal, brokerage, or financial advice.', 'Generated forms, templates, alerts, readiness scores, proof summaries, and buyer packet workflows are operational aids only. Users should consult qualified professionals before relying on them.'] },
      { title: 'Buyer packets', body: ['Buyer-facing profiles, sale packets, shared links, public packets, and generated documents contain information supplied, selected, approved, or released by the user.', 'XBAR LLC does not independently verify horse identity, registration status, title, ownership, lien status, medical condition, sale terms, or health records. Buyers and sellers must independently verify all information.'] },
      { title: 'Limitation of liability', body: ['To the maximum extent permitted by law, XBAR LLC is not liable for lost profits, lost sales, horse injury, buyer disputes, registration issues, transfer disputes, veterinary decisions, inaccurate user data, third-party service failures, data loss, indirect damages, consequential damages, special damages, or punitive damages.', 'To the maximum extent permitted by law, XBAR LLC total liability for claims arising from the service is limited to the amount paid by the customer to XBAR during the three months before the event giving rise to the claim.'] },
      { title: 'Governing law', body: ['Unless a separate written agreement states otherwise, these Terms are governed by the laws of the State of Texas, without regard to conflict-of-law rules. Venue and dispute language should be reviewed by counsel before final launch.'] },
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
      { title: 'Information collected', body: ['XBAR may collect account information, user names, emails, workspace details, ranch profile data, horse records, ownership data, medical and care records, document files, media, receipts, expense records, buyer lead data, shared packet settings, device and usage information, and support communications.', 'Payment card details are handled by payment processors such as Stripe. XBAR does not intentionally store full payment card numbers in the application database.'] },
      { title: 'How information is used', body: ['XBAR uses information to provide the service, authenticate users, sync workspaces, generate documents, organize proof records, create buyer packets, process subscriptions, provide support, improve reliability, maintain security, and comply with legal obligations.', 'XBAR does not sell ranch, horse, buyer, ownership, medical, or document data to advertisers.'] },
      { title: 'Third-party providers', body: ['XBAR may use service providers for hosting, authentication, database storage, object storage, payments, email, analytics, error monitoring, weather data, and document processing.'] },
      { title: 'Retention and deletion', body: ['Customer data is generally retained while the account or workspace is active and as needed for backups, legal obligations, security, billing, and dispute resolution. Customers should export critical records before deleting data or canceling service.'] },
      { title: 'Security', body: ['XBAR uses reasonable safeguards to protect account and workspace data. No online system can be guaranteed completely secure. Users are responsible for protecting passwords and controlling workspace invitations.'] },
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
      { title: 'Paid plans', body: ['XBAR offers paid subscription plans for ranch, barn, breeder, and horse operation workflows. Features, limits, seats, storage, templates, buyer packet tools, and advanced workflows may vary by plan.'] },
      { title: 'Automatic renewal', body: ['Unless otherwise stated at checkout, paid subscriptions renew automatically on a monthly basis until canceled. By subscribing, the customer authorizes recurring charges to the payment method on file.'] },
      { title: 'Cancellation and refunds', body: ['Customers may cancel future renewal through the billing portal or support workflow made available by XBAR. Unless required by law or separately agreed in writing, XBAR does not provide refunds or credits for partial months, unused features, inactive accounts, plan downgrades, unused storage, or failure to cancel before renewal.'] },
      { title: 'Taxes and processors', body: ['Taxes, payment authorization, invoices, receipts, and payment method updates may be handled by Stripe or another payment processor. Customers are responsible for applicable taxes, bank charges, failed payment fees, chargebacks, and amounts required by the selected subscription.'] },
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
      { title: 'User-supplied records', body: ['Horse records, buyer packets, sale information, medical notes, veterinary data, ownership fields, title records, documents, images, and generated summaries are supplied, uploaded, selected, or approved by users. XBAR LLC does not independently inspect horses, verify registry records, confirm lien status, validate veterinary conclusions, authenticate signatures, or guarantee that user-supplied records are complete or accurate.'] },
      { title: 'Buyer verification required', body: ['Buyer-facing packets are informational tools only. Buyers should independently verify registration, identity, ownership, liens, health status, Coggins, veterinary history, soundness, performance claims, breeding status, insurance status, possession, and sale terms before payment or transfer.'] },
      { title: 'No veterinary or transfer advice', body: ['XBAR care status and transfer workflows are operational tracking tools only. XBAR does not determine veterinary treatment, legal ownership, lien priority, registry eligibility, escrow status, or transfer validity.'] },
      { title: 'Generated documents', body: ['Generated documents, templates, packets, and pre-filled forms are drafting aids. Users must review all generated content before signing, sending, filing, or relying on it.'] },
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
      { title: 'XBAR marks', body: ['XBAR LLC(TM), XBAR(TM), XBAR Command Infrastructure(TM), XBAR Proof Vault(TM), XBAR Command Files(TM), XBAR Buyer Packet(TM), the XBAR name, the XBAR logo, product names, service names, graphics, icons, and trade dress are trademarks, service marks, or brand identifiers of XBAR LLC unless otherwise stated.', 'The TM symbol gives notice that XBAR claims trademark rights. The registered trademark symbol should not be used unless and until a mark is registered with the appropriate trademark office.'] },
      { title: 'No license without permission', body: ['Use of the XBAR name, logo, screenshots, product interface, buyer packet marks, marketing copy, or brand assets does not grant ownership or a license except as expressly allowed in writing by XBAR LLC.'] },
      { title: 'Buyer packet attribution', body: ['Buyer packets, generated documents, and shared links may identify that they were generated using XBAR. That attribution does not mean XBAR verified the horse, seller, buyer, price, ownership, health, title, or transaction terms.'] },
    ],
  },
  {
    id: 'acceptable-use',
    title: 'XBAR LLC Acceptable Use and Content Policy',
    shortTitle: 'Acceptable Use',
    purpose: 'Rules for uploads, buyer packets, records, misuse, account security, and prohibited content.',
    lastUpdated: legalLastUpdated,
    suggestedFileName: 'xbar-llc-acceptable-use-content-policy.html',
    notice: 'Operational baseline for account enforcement and content standards.',
    sections: [
      { title: 'Accurate records', body: ['Users may not knowingly upload, create, approve, or share false, altered, misleading, unauthorized, or incomplete records intended to mislead buyers, owners, registries, veterinarians, insurers, lenders, courts, tax authorities, or other third parties.'] },
      { title: 'Authorized content only', body: ['Users should upload only documents, images, records, and personal information they have the right to store, process, and share. This includes buyer information, owner information, veterinary documents, contracts, signatures, and financial records.'] },
      { title: 'Shared links and public content', body: ['Users are responsible for reviewing buyer-facing content before sharing any link. Public or token-based links may be forwarded beyond the original recipient. Sensitive internal notes, medical details, financial records, private owner information, and unverified documents should not be released unless the user has authority and a legitimate reason to share them.'] },
    ],
  },
];

export const legalDocumentById: Record<LegalDocumentId, LegalDocument> = legalDocuments.reduce((accumulator, legalDoc) => {
  accumulator[legalDoc.id] = legalDoc;
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

export function legalDocumentToHtml(legalDoc: LegalDocument) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(legalDoc.title)}</title><style>body{font-family:Arial,sans-serif;margin:42px;color:#17202a;line-height:1.55}header{border-bottom:2px solid #17202a;margin-bottom:24px;padding-bottom:16px}h1{font-size:26px;margin:0 0 8px}h2{font-size:15px;margin-top:24px;text-transform:uppercase;letter-spacing:.08em}p{font-size:13px}.notice{background:#fff8e5;border:1px solid #ead28a;padding:12px;margin:16px 0}.footer{margin-top:28px;color:#667;font-size:12px;border-top:1px solid #d8dee6;padding-top:12px}</style></head><body><header><h1>${escapeHtml(legalDoc.title)}</h1><div>XBAR LLC(TM) · Last updated ${escapeHtml(legalDoc.lastUpdated)}</div></header><div class="notice"><strong>Review notice:</strong> ${escapeHtml(legalDoc.notice)}</div>${legalDoc.sections.map((section) => `<section><h2>${escapeHtml(section.title)}</h2>${section.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}</section>`).join('')}<div class="footer">XBAR LLC(TM). XBAR(TM) and related marks are trademarks or service marks claimed by XBAR LLC. This printable document is generated from the XBAR legal document library.</div></body></html>`;
}

export function openPrintableLegalDocument(legalDoc: LegalDocument) {
  const preview = window.open('', '_blank', 'noopener,noreferrer');
  if (!preview) return false;
  preview.document.write(legalDocumentToHtml(legalDoc));
  preview.document.close();
  preview.focus();
  return true;
}

export function downloadLegalHtml(legalDoc: LegalDocument) {
  const blob = new Blob([legalDocumentToHtml(legalDoc)], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = legalDoc.suggestedFileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
