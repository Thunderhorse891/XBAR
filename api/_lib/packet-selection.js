// Which of a horse's documents go into a sale packet, and what to say about
// the ones that do not.
//
// Every document the seller asked for ends up in exactly one of two places:
// the packet, or the omissions list. It used to be possible for a selection to
// land in neither — the storage_path filter ran first and dropped device-only
// documents before anything counted them, so a Coggins the seller had ticked
// was absent from the PDF, absent from the omissions list, and the wizard
// reported the packet ready. A packet that quietly lacks the proof it is
// believed to carry is the one failure this whole path exists to prevent, and
// the buyer is who finds out.

/**
 * Split a horse's documents into the ones this endpoint can embed and a plain
 * list of what it could not, one line per omission.
 *
 * @param {Array<{document_id: string, title: string, storage_path?: string|null}>} documents
 *   Every document on the horse, in the order they should appear.
 * @param {string[]} requestedIds
 *   The seller's selection. Empty means "everything on this horse".
 * @param {number} maxAttachments Hard cap on documents in one packet.
 * @returns {{packetDocs: Array<object>, unavailable: string[]}}
 */
export function selectPacketDocuments(documents, requestedIds, maxAttachments) {
  const requestedSet = requestedIds.length ? new Set(requestedIds) : null;
  let packetDocs = requestedSet ? documents.filter((doc) => requestedSet.has(doc.document_id)) : documents.slice();
  const unavailable = [];

  // A selection that is no longer on the horse — detached or deleted between
  // the wizard loading and the seller pressing generate.
  if (requestedSet) {
    const found = new Set(packetDocs.map((doc) => doc.document_id));
    for (const id of requestedIds) {
      if (!found.has(id)) unavailable.push(`${id} (no longer attached to this horse)`);
    }
  }

  // No storage_path means the file never reached the bucket: it lives only in
  // the seller's on-device vault, so this endpoint cannot embed it.
  for (const doc of packetDocs) {
    if (!doc.storage_path) unavailable.push(`${doc.title} (stored on the seller's device, not in the cloud)`);
  }
  packetDocs = packetDocs.filter((doc) => doc.storage_path);

  if (packetDocs.length > maxAttachments) {
    for (const doc of packetDocs.slice(maxAttachments)) {
      unavailable.push(`${doc.title} (over the ${maxAttachments}-document packet limit)`);
    }
    packetDocs = packetDocs.slice(0, maxAttachments);
  }

  return { packetDocs, unavailable };
}

/**
 * The cover section naming what the packet does not contain, or null.
 *
 * Recording an omission in the API response told the SELLER. The buyer reads
 * the PDF, and the PDF said nothing — it listed what was included and stopped,
 * so a packet missing a Coggins looked exactly like one that never had a
 * requirement for it. That is the same silent omission one layer further out,
 * and the buyer is the party who cannot ask the database what happened.
 *
 * Wording follows the local renderer's "Not included in this packet" notice
 * deliberately: a seller who has seen both must not have to work out whether
 * they mean the same thing.
 *
 * @param {string[]} unavailable Reasons, already formatted "Title (why)".
 * @returns {{heading: string, lines: string[]} | null}
 */
export function packetOmissionSection(unavailable) {
  if (!unavailable.length) return null;
  return {
    heading: 'Not Included In This Packet',
    lines: [
      ...unavailable.map((item, index) => `${index + 1}. ${item}`),
      unavailable.length === 1
        ? 'Ask the seller to send this file separately.'
        : 'Ask the seller to send these files separately.',
    ],
  };
}
