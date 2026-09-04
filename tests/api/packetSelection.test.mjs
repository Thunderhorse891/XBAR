import assert from 'node:assert/strict';
import test from 'node:test';

import { packetOmissionSection, selectPacketDocuments } from '../../api/_lib/packet-selection.js';

/*
 * A sale packet that silently lacks a document is the failure this file exists
 * to catch. The seller ticks the Coggins, the wizard says the packet is ready,
 * and the buyer is the one who finds out it is not in there.
 *
 * So the invariant these tests hold is an accounting one, not a filtering one:
 * every requested id must come back either in `packetDocs` or named in
 * `unavailable`. Never neither.
 */

const doc = (id, title, storagePath = `docs/${id}.pdf`) => ({
  document_id: id,
  title,
  storage_path: storagePath,
});

/** The invariant itself, asserted the same way for every case below. */
function assertNothingVanishes(documents, requestedIds, result) {
  const ids = requestedIds.length ? requestedIds : documents.map((entry) => entry.document_id);
  const included = new Set(result.packetDocs.map((entry) => entry.document_id));
  const titleById = new Map(documents.map((entry) => [entry.document_id, entry.title]));
  for (const id of ids) {
    if (included.has(id)) continue;
    const named = result.unavailable.some((line) => line.includes(titleById.get(id) ?? id));
    assert.ok(named, `${id} is in neither the packet nor the omissions list`);
  }
}

test('a device-only document is named, not silently dropped', () => {
  // The bug: `documents.filter((d) => d.storage_path)` ran before anything
  // counted the selection, so a document whose cloud upload had fallen back to
  // the on-device vault disappeared without a word.
  const documents = [doc('d1', 'Coggins', null), doc('d2', 'Registration')];
  const result = selectPacketDocuments(documents, ['d1', 'd2'], 20);

  assert.deepEqual(
    result.packetDocs.map((entry) => entry.document_id),
    ['d2'],
  );
  assert.deepEqual(result.unavailable, ["Coggins (stored on the seller's device, not in the cloud)"]);
  assertNothingVanishes(documents, ['d1', 'd2'], result);
});

test('a selection that is no longer on the horse is reported', () => {
  // Detached or deleted between the wizard loading and generate being pressed.
  const documents = [doc('d1', 'Coggins')];
  const result = selectPacketDocuments(documents, ['d1', 'gone'], 20);

  assert.deepEqual(
    result.packetDocs.map((entry) => entry.document_id),
    ['d1'],
  );
  assert.deepEqual(result.unavailable, ['gone (no longer attached to this horse)']);
});

test('documents past the attachment cap are named rather than truncated away', () => {
  const documents = Array.from({ length: 4 }, (unused, index) => doc(`d${index}`, `Doc ${index}`));
  const requested = documents.map((entry) => entry.document_id);
  const result = selectPacketDocuments(documents, requested, 2);

  assert.deepEqual(
    result.packetDocs.map((entry) => entry.document_id),
    ['d0', 'd1'],
  );
  assert.deepEqual(result.unavailable, [
    'Doc 2 (over the 2-document packet limit)',
    'Doc 3 (over the 2-document packet limit)',
  ]);
  assertNothingVanishes(documents, requested, result);
});

test('an empty selection means every document on the horse, and still accounts for each', () => {
  const documents = [doc('d1', 'Coggins'), doc('d2', 'Registration', null)];
  const result = selectPacketDocuments(documents, [], 20);

  assert.deepEqual(
    result.packetDocs.map((entry) => entry.document_id),
    ['d1'],
  );
  assert.deepEqual(result.unavailable, ["Registration (stored on the seller's device, not in the cloud)"]);
  assertNothingVanishes(documents, [], result);
});

test('the ordinary case reports nothing missing', () => {
  // The over-rejection direction. A packet that warns about files it did
  // include teaches the seller to ignore the warning.
  const documents = [doc('d1', 'Coggins'), doc('d2', 'Registration')];
  const result = selectPacketDocuments(documents, ['d1', 'd2'], 20);

  assert.deepEqual(
    result.packetDocs.map((entry) => entry.document_id),
    ['d1', 'd2'],
  );
  assert.deepEqual(result.unavailable, []);
});

test('the packet keeps the horse order, not the order the seller ticked boxes in', () => {
  const documents = [doc('d1', 'Coggins'), doc('d2', 'Registration'), doc('d3', 'Vet report')];
  const result = selectPacketDocuments(documents, ['d3', 'd1'], 20);

  assert.deepEqual(
    result.packetDocs.map((entry) => entry.document_id),
    ['d1', 'd3'],
  );
});

test('what the packet leaves out reaches the buyer, not just the seller', async () => {
  /*
   * Recording an omission in the API response told the SELLER. The buyer reads
   * the PDF, and the PDF listed what was included and stopped — so a packet
   * missing a Coggins looked exactly like one that never needed one. Same
   * silent omission, one layer further out, and the buyer is the party who
   * cannot go and ask the database what happened.
   */
  const documents = [doc('d1', 'Coggins', null), doc('d2', 'Registration')];
  const { unavailable } = selectPacketDocuments(documents, ['d1', 'd2'], 20);
  const section = packetOmissionSection(unavailable);

  assert.ok(section, 'an omission must produce a cover section');
  assert.match(section.heading, /Not Included/i);
  assert.ok(
    section.lines.some((line) => line.includes('Coggins')),
    'the buyer must be told which document is missing, by name',
  );
  assert.ok(
    section.lines.some((line) => /ask the seller/i.test(line)),
    'and what to do about it',
  );

  // Singular and plural read correctly — this is a document a buyer reads.
  assert.ok(section.lines.at(-1).includes('this file'), 'one omission is "this file"');
  const many = packetOmissionSection(['A (reason)', 'B (reason)']);
  assert.ok(many.lines.at(-1).includes('these files'), 'two omissions are "these files"');

  // The over-rejection direction: a complete packet must not carry a notice
  // about files it did include.
  assert.equal(packetOmissionSection([]), null, 'a complete packet gets no notice at all');

  // And the section is actually wired into the cover, after the included list.
  const { readFile } = await import('node:fs/promises');
  const handler = await readFile(new URL('../../api/sale-packets.js', import.meta.url), 'utf8');
  assert.match(handler, /const omissionSection = packetOmissionSection\(unavailable\);/);
  assert.match(handler, /\.\.\.\(omissionSection \? \[omissionSection\] : \[\]\),/);

  // Built after the download loop, or a file that failed to come out of
  // storage would be named to the seller and hidden from the buyer.
  const loopAt = handler.indexOf("unavailable.push(`${doc.title} (${error?.message || 'download failed'})`)");
  const builtAt = handler.indexOf('const omissionSection = packetOmissionSection(unavailable);');
  assert.ok(loopAt > -1 && builtAt > loopAt, 'the section must be built after every omission is known');
});

test('a document that failed to download is described as absent everywhere', async () => {
  /*
   * The appendix made this contradiction visible rather than causing it: a
   * download failure was recorded in `unavailable` while the document stayed in
   * `packetDocs`, so the same PDF page listed it under "Included Documents" and
   * again under what is missing. The database row and the API response claimed
   * it too — and worst of the four, so did the SEAL, which is the one mechanism
   * in the product whose entire job is to be trustworthy. A buyer verifying it
   * would have been assured the packet contains a Coggins that is not in it.
   *
   * Asserted from source: the loop is a live Supabase storage call, so the
   * alternative is a bucket. What is checkable here is that nothing describing
   * the packet is built from the pre-download selection.
   */
  const { readFile } = await import('node:fs/promises');
  const handler = await readFile(new URL('../../api/sale-packets.js', import.meta.url), 'utf8');
  const code = handler.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  // Only the download loop may read the selection.
  const readsSelection = code.match(/packetDocs/g) ?? [];
  assert.equal(
    readsSelection.length,
    2,
    `packetDocs must appear only where it is created and where it is iterated, found ${readsSelection.length}`,
  );
  assert.match(code, /for \(const doc of packetDocs\)/, 'the download loop is the one reader');

  // Everything that describes the packet reads what survived the download.
  for (const [field, why] of [
    ['documents: includedDocs,', 'the seal must cover only what is in the packet'],
    ['includedDocs.map((doc, index)', 'the cover list must name only what is in it'],
    ['document_ids: includedDocs.map', 'the stored row must record only what is in it'],
    ['includedDocumentIds: includedDocs.map', 'the API response must report only what is in it'],
    ['documents: includedDocs.length,', 'the audit count must count only what is in it'],
  ]) {
    assert.ok(code.includes(field), `${field} — ${why}`);
  }

  // And a failed download is still named to the buyer, so the two sets partition
  // the selection rather than both dropping it.
  assert.match(code, /unavailable\.push\(`\$\{doc\.title\} \(\$\{error\?\.message \|\| 'download failed'\}\)`\)/);
});
