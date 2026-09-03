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
