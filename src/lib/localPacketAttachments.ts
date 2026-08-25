import { blobToBase64, readLocalFile } from './localFileVault.js';
import type { DocumentRecord } from '../types/xbar.js';

/*
 * Putting the actual documents into a locally generated sale packet.
 *
 * The cloud path downloads each selected document and appends it into one PDF,
 * with an "Items Not Embedded" appendix for anything it could not include. The
 * local path shipped a summary that listed the documents by title and contained
 * none of them — while the wizard told the seller their approved documents were
 * "bundled". A buyer opening that packet would find no Coggins, no
 * registration, and nothing saying either was missing.
 *
 * This resolves the bytes that are genuinely on this device, and names what is
 * not, so the packet can say both truthfully.
 */

/** One file, ready to be embedded in the packet HTML. */
export interface LocalPacketAttachment {
  id: string;
  label: string;
  fileName: string;
  dataUrl: string;
  sizeBytes: number;
}

/** A document that was selected but could not be attached, and why. */
export interface UnattachedDocument {
  title: string;
  reason: string;
}

/**
 * The same ceiling the cloud packet builder uses, so a seller does not get a
 * different set of documents depending on which path produced the packet.
 */
export const MAX_PACKET_ATTACHMENTS = 20;

/**
 * Total source bytes allowed across all attachments.
 *
 * Base64 adds about a third, so 25MB of documents becomes a ~34MB HTML file.
 * Past roughly that, browsers and mail servers start refusing it, and a packet
 * the buyer cannot open is worse than one that says a file was too large to
 * include.
 */
export const MAX_PACKET_ATTACHMENT_BYTES = 25 * 1024 * 1024;

export interface AttachmentPlan {
  attach: DocumentRecord[];
  excluded: UnattachedDocument[];
}

function label(document: DocumentRecord): string {
  return `${document.type}: ${document.title}`;
}

/**
 * Decide, from metadata alone, which documents can go in.
 *
 * Eligibility only: does this record point at a file on this device at all?
 *
 * The ceilings deliberately do NOT live here. Both of the values this pass
 * could budget against are guesses — `fileSizeBytes` is optional and a legacy
 * record may not carry it, and a `localFileKey` can be dangling after a partial
 * restore. Spending a count slot or a byte allowance on a guess lets an
 * unreadable record displace a file that could actually have been bundled: put
 * twenty stale keys ahead of one good document and the good one was reported
 * over-limit while the packet embedded nothing.
 *
 * So this pass answers the one question it can answer for certain, with a
 * reason for every exclusion, and `resolvePacketAttachments` applies the limits
 * against the bytes and the files the vault really has.
 */
export function planPacketAttachments(documents: DocumentRecord[]): AttachmentPlan {
  const attach: DocumentRecord[] = [];
  const excluded: UnattachedDocument[] = [];

  for (const document of documents) {
    if (!document.localFileKey) {
      excluded.push({
        title: label(document),
        // Distinguished deliberately: "in the cloud" is recoverable by signing
        // in, "no file" means the record never had one. Telling a seller to
        // sign in to retrieve a file that does not exist wastes their evening.
        reason: document.storagePath
          ? 'stored in cloud storage, not on this device'
          : 'no file was attached to this record',
      });
      continue;
    }

    attach.push(document);
  }

  return { attach, excluded };
}

/**
 * Read a blob back as a `data:` URL.
 *
 * Data URLs are what let the packet be ONE file. A sale packet is emailed, put
 * on a USB stick, and opened on a phone; a folder of loose files with an index
 * referencing them by relative path survives none of that.
 *
 * The encoding itself lives in the vault, shared with the workspace backup:
 * both are round trips of the same bytes, and two encoders that disagree lose
 * files silently.
 */
async function toDataUrl(blob: Blob, mimeType: string): Promise<string> {
  return `data:${mimeType || 'application/octet-stream'};base64,${await blobToBase64(blob)}`;
}

/**
 * Resolve the planned documents to embeddable attachments.
 *
 * A document that plans in but cannot be read moves to `excluded` rather than
 * being dropped. Silently shipping a packet one document short is the failure
 * this whole change exists to remove.
 */
export async function resolvePacketAttachments(
  documents: DocumentRecord[],
  limits?: { maxCount?: number; maxBytes?: number },
): Promise<{ attachments: LocalPacketAttachment[]; unattached: UnattachedDocument[] }> {
  const plan = planPacketAttachments(documents);
  const maxCount = limits?.maxCount ?? MAX_PACKET_ATTACHMENTS;
  const maxBytes = limits?.maxBytes ?? MAX_PACKET_ATTACHMENT_BYTES;
  const attachments: LocalPacketAttachment[] = [];
  const unattached = [...plan.excluded];
  /*
   * Both ceilings bind here, against what the vault actually returned.
   *
   * A slot is spent only once a file has been read, so a dangling key costs
   * nothing but the read: unreadable records can no longer displace files that
   * could have been bundled. And the bytes are the real bytes, not the
   * optional `fileSizeBytes` a legacy record may not carry — without that, a
   * handful of size-less records could produce a base64 packet of any size at
   * all, which is a browser tab running out of memory rather than a document.
   */
  let usedBytes = 0;

  for (const document of plan.attach) {
    if (attachments.length >= maxCount) {
      unattached.push({ title: label(document), reason: `over the ${maxCount}-document packet limit` });
      continue;
    }

    try {
      const entry = await readLocalFile(document.localFileKey as string);
      if (!entry) {
        unattached.push({ title: label(document), reason: 'the stored file is no longer on this device' });
        continue;
      }
      if (usedBytes + entry.size > maxBytes) {
        // Same reason string as the planner's: the seller does not care which
        // pass measured it, only that this document is not in the packet.
        unattached.push({ title: label(document), reason: 'too large to include in this packet' });
        continue;
      }
      usedBytes += entry.size;
      attachments.push({
        id: document.id,
        label: label(document),
        fileName: entry.name || document.fileName || document.title,
        dataUrl: await toDataUrl(entry.blob, entry.type || document.mimeType || ''),
        sizeBytes: entry.size,
      });
    } catch (error) {
      console.error('Reading a packet document from this device failed.', error);
      unattached.push({ title: label(document), reason: 'the stored file could not be read' });
    }
  }

  return { attachments, unattached };
}
