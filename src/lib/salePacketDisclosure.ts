// What a buyer sale packet is allowed to say about a horse.
//
// A packet is not a public share, and it is not the whole record either. It goes
// to one named buyer, under a watermark, and it has to answer three questions:
// is this the horse you say it is, can you actually sell it to me, and what is
// the deal. Everything outside those three questions is the seller's business.
//
// This is an allowlist, and it exists because the local packet generator was
// handed the entire `HorseRecord` and rendered whatever it liked from it. That
// put the seller's negotiating position and a third party's contact details into
// a document emailed to strangers. An allowlist means a field added to
// `HorseRecord` next month cannot appear in a buyer's packet by default — the
// same discipline `toPublicPassport` applies to public shares, at the wider
// disclosure level a named-buyer packet legitimately needs.
//
// The reference point is the cloud packet (`api/sale-packets.js`), which is the
// artifact this one exists to match. It renders identity, microchip, the latest
// Coggins date, and the legal owner — and nothing else about the horse. Where
// this DTO and that cover sheet differ, the difference is deliberate and noted
// below.
//
// Deliberately INCLUDED, though they may look sensitive:
//
//   microchipId  — how a buyer confirms the horse in the trailer is the horse in
//                  the papers. The cloud packet ships it for that reason. A
//                  sale packet without it fails at its first job.
//   legalOwner,  — you cannot buy a horse without knowing who is selling it and
//   ownerEntity    whether the title can move. The release gate's whole verdict
//   transferStatus is about this.
//   pendingDocuments,
//   complianceDeadline
//
// Deliberately EXCLUDED:
//
//   buyerConfidence,  — the seller's negotiating position, handed to the party
//   watchlistCount,     negotiating against them. `publicShare.ts` already zeroes
//   inquiryCount        exactly these three ("not internal confidence or inquiry
//                       counts"); the packet contradicted a rule the codebase
//                       had already made. Telling a buyer "inquiries: 0" is a
//                       leak that costs the user money.
//   veterinarian,     — names and contact details of third parties who never
//   farrier             agreed to appear in a document sent to strangers.
//   medicalNotes      — unreviewed internal free text. Health disclosure belongs
//                       in the packet, but as dated facts from the documents the
//                       seller deliberately selected — which is how the cloud
//                       packet does it — not as whatever someone typed into a
//                       notes field at 6am.
//
// Health disclosure is therefore not removed, it is relocated: the selected
// documents (Coggins, vet records) are listed, summarized and embedded, and the
// release gate names what is missing. That is a disclosure the seller chose.

// Relative, with the extension, like `buyerSafePassport.ts`: this module has to
// compile in the node test build as well as the app build, and only the app
// build resolves the `@/` alias.
import type { HorseRecord, OwnershipRecord, WorkspaceProfile } from '../types/xbar.js';

export interface PacketIdentityDisclosure {
  name: string;
  barnName: string;
  breed: string;
  sex: string;
  color: string;
  markings: string;
  foaledOn: string;
  age: number;
  registered: boolean;
  registry: string;
  registrationNumber: string;
  microchipId: string;
  sire: string;
  dam: string;
}

export interface PacketSaleDisclosure {
  askPrice: number;
  listingState: string;
}

export interface PacketOwnershipDisclosure {
  legalOwner: string;
  ownerEntity: string;
  transferStatus: string;
  pendingDocuments: string[];
  complianceDeadline: string;
}

/**
 * Care facts a buyer may see: what the horse is doing, and when it was last
 * seen by a vet. A DATE, not a diagnosis — the diagnosis is in the vet record
 * the seller chose to attach, where a buyer can read it in full and in context.
 */
export interface PacketCareDisclosure {
  status: string;
  lastVetVisit: string;
}

export interface PacketDisclosure {
  identity: PacketIdentityDisclosure;
  sale: PacketSaleDisclosure;
  ownership: PacketOwnershipDisclosure;
  care: PacketCareDisclosure;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Build the buyer-facing disclosure for a sale packet. Allowlist only.
 *
 * Every consumer — the rendered page AND the sealed credential — must read from
 * this rather than from the record, so the packet cannot disclose something the
 * seal does not cover, and the seal cannot cover something the packet does not
 * show. That symmetry matters more than usual now: the sealed payload is
 * published verbatim inside the packet so a buyer can recompute the digest, so
 * anything sealed is also anything disclosed.
 */
export function toPacketDisclosure(
  horse: HorseRecord,
  ownershipRecord?: OwnershipRecord,
  workspaceProfile?: WorkspaceProfile,
): PacketDisclosure {
  return {
    identity: {
      name: str(horse.name),
      barnName: str(horse.barnName),
      breed: str(horse.breed),
      sex: str(horse.sex),
      color: str(horse.color),
      markings: str(horse.markings),
      foaledOn: str(horse.foaledOn),
      age: typeof horse.age === 'number' ? horse.age : 0,
      registered: Boolean(horse.registered),
      registry: str(horse.registry),
      registrationNumber: str(horse.registrationNumber) || str(horse.aqhaNumber),
      microchipId: str(horse.microchipId),
      sire: str(horse.bloodline?.sire),
      dam: str(horse.bloodline?.dam),
    },
    sale: {
      askPrice: horse.sale?.askPrice ?? 0,
      listingState: str(horse.sale?.listingState),
    },
    ownership: {
      legalOwner: str(ownershipRecord?.legalOwner) || str(horse.owner),
      ownerEntity: str(horse.ownerEntity) || str(workspaceProfile?.defaultOwnerEntity),
      transferStatus: str(ownershipRecord?.transferStatus) || 'Attention Required',
      pendingDocuments: ownershipRecord?.pendingDocuments ?? [],
      complianceDeadline: str(ownershipRecord?.complianceDeadline),
    },
    care: {
      status: str(horse.status),
      lastVetVisit: str(horse.lastVetVisit),
    },
  };
}
