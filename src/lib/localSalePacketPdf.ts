import { PDFDocument } from 'pdf-lib';
import { createSectionedPdf, assemblePacketPdf } from '../../api/_lib/pdf.js';
import { normalizePacketBranding } from '../../api/_lib/packet-branding.js';
import { toPacketDisclosure } from './salePacketDisclosure.js';
import { base64ToBytes } from './localFileVault.js';
import { loadReportBranding, type ReportBranding } from './reportBranding.js';
import type { LocalSalePacket } from './localSalePacketGenerator.js';
import type { LocalPacketAttachment } from './localPacketAttachments.js';
import type { HorseRecord, OwnershipRecord, WorkspaceProfile } from '../types/xbar.js';

/** The device packet uses the same PDF assembly as cloud packets. Keep its
 * interactive sealed HTML and exact originals inside the single saved PDF. */
export async function renderLocalSalePacketPdf(input: {
  packet: LocalSalePacket;
  horse: HorseRecord;
  ownershipRecord?: OwnershipRecord;
  profile: WorkspaceProfile;
  attachments: LocalPacketAttachment[];
  watermark: string;
  buyerName?: string;
  branding?: ReportBranding;
}) {
  const { packet } = input;
  const shown = toPacketDisclosure(input.horse, input.ownershipRecord, input.profile);
  const seller = normalizePacketBranding(input.profile);
  const dollars =
    shown.sale.askPrice > 0
      ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(shown.sale.askPrice)
      : 'Not listed';
  const attachments = input.attachments.map((file) => {
    const match = /^data:([^;,]+);base64,(.+)$/s.exec(file.dataUrl);
    if (!match) throw new Error(`The original ${file.fileName} could not be read. Generate this packet again.`);
    return { ...file, bytes: base64ToBytes(match[2]), mimeType: match[1] };
  });
  const coverBytes = await createSectionedPdf({
    title: 'Buyer sale packet',
    letterhead: seller.displayName,
    customerLogoDataUrl: seller.logoDataUrl,
    branding: input.branding ?? (await loadReportBranding()),
    continuationHeaders: true,
    reference: packet.credential.sealCode,
    sections: [
      {
        heading: shown.identity.name || 'Unnamed horse',
        lines: [
          `Identity: ${[shown.identity.breed, shown.identity.sex, shown.identity.color].filter(Boolean).join(' / ') || 'Not provided'}`,
          `Registration: ${[shown.identity.registry, shown.identity.registrationNumber].filter(Boolean).join(' / ') || 'Not provided'}`,
          `Foaled: ${shown.identity.foaledOn || 'Not provided'}`,
          `Microchip: ${shown.identity.microchipId || 'Not provided'}`,
          `Asking price: ${dollars}`,
          `Listing state: ${shown.sale.listingState || 'Not provided'}`,
        ],
      },
      {
        heading: 'Seller and handoff',
        lines: [
          `Recorded owner (seller supplied): ${shown.ownership.legalOwner || 'Not provided'}`,
          `Owner entity: ${shown.ownership.ownerEntity || 'Not provided'}`,
          `Seller-recorded transfer status: ${shown.ownership.transferStatus}`,
          `Pending documents: ${shown.ownership.pendingDocuments.join(', ') || 'None recorded'}`,
          `Contact: ${[seller.name, seller.email, seller.phone, seller.website].filter(Boolean).join(' / ') || 'Not provided'}`,
          `Prepared for: ${input.buyerName?.trim() || 'Prospective buyer'}`,
          `Prepared on: ${packet.credential.sealedAt.slice(0, 10)}`,
        ],
      },
      {
        heading: 'Care and disclosure',
        lines: [
          `Recorded status: ${shown.care.status || 'Not provided'}`,
          `Last vet visit: ${shown.care.lastVetVisit || 'Not provided'}`,
          'Read the selected veterinary records and Coggins. This summary does not establish health, travel clearance or fitness for a purpose.',
        ],
      },
      {
        heading: 'Selected approved records',
        lines: packet.includedDocuments.map((file) => `${file.type}: ${file.title}`),
      },
      ...(packet.unattachedDocuments.length
        ? [
            {
              heading: 'Originals not included',
              lines: packet.unattachedDocuments.map((file) => `${file.title}: ${file.reason}`),
            },
          ]
        : []),
      {
        heading: 'Record fingerprint and originals',
        lines: [
          `Local record seal: ${packet.credential.sealCode}`,
          `SHA-256: ${packet.credential.digest}`,
          'This is a device-generated packet, not a server-anchored verification. A printed code does not verify this PDF.',
          'The PDF contains the interactive packet HTML and exact original files as attachments. Open the HTML in a browser to recompute its record and file hashes, then compare with a seal obtained independently from the seller. PDF/image originals also follow as pages where readable. Some phone PDF viewers do not expose attached files; use the interactive copy on a compatible reader.',
          'The seal detects changes, not truthfulness. Independently verify identity, ownership, liens, sale terms, veterinary condition and authority to sell before payment or transport.',
        ],
      },
    ],
    footer: `${seller.displayName || 'Horse seller'} / Prepared with XBAR / Seller-supplied records`,
  });
  const assembled = await assemblePacketPdf({
    coverBytes,
    attachments: attachments.filter((file) =>
      ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'].includes(file.mimeType),
    ),
    watermarkText: input.watermark,
  });
  const pdf = await PDFDocument.load(assembled);
  await pdf.attach(new TextEncoder().encode(packet.html), packet.fileName, {
    mimeType: 'text/html',
    description: 'Interactive buyer packet; recompute the record seal and open exact original files.',
  });
  for (const [index, file] of attachments.entries())
    await pdf.attach(file.bytes, `${index + 1}-${file.fileName}`, { mimeType: file.mimeType, description: file.label });
  pdf.setTitle(`${shown.identity.name || 'Unnamed horse'} / Buyer sale packet`);
  pdf.setProducer('XBAR');
  return { bytes: await pdf.save(), fileName: packet.fileName.replace(/\.html$/, '.pdf') };
}
