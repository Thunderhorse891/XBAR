import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_PACKET_ATTACHMENTS,
  planPacketAttachments,
  resolvePacketAttachments,
} from '../src/lib/localPacketAttachments.js';
import { storeLocalFile } from '../src/lib/localFileVault.js';
import type { DocumentRecord } from '../src/types/xbar.js';
import { installFakeIndexedDb } from './helpers/fakeIndexedDb.js';

/** The workspace these tests write as: vault entries record an owner so the
 * sweep can never delete another workspace's files. */
const TEST_WORKSPACE = 'ws-test';

/*
 * A sale packet that lists documents it does not contain is worse than one that
 * admits it is a summary: the seller sends it believing the Coggins is in
 * there, and the buyer is the one who finds out.
 *
 * The cloud path downloads each selected document and appends it. These cover
 * the local path doing the same from the on-device vault, and — just as
 * important — naming everything it could not include, with a reason the seller
 * can act on.
 */

function document(overrides: Partial<DocumentRecord> & Pick<DocumentRecord, 'id' | 'title'>): DocumentRecord {
  return {
    type: 'Coggins',
    uploadedBy: 'Ranch Owner',
    uploadedAt: '2026-06-02',
    source: 'Upload',
    state: 'Ready',
    confidence: 96,
    duplicateRisk: 'Low',
    extractedTextPreview: '',
    summary: '',
    entities: {},
    ...overrides,
  } as DocumentRecord;
}

test('a document with no file on this device is excluded with the reason why', () => {
  const plan = planPacketAttachments([
    document({ id: 'd1', title: 'Coggins 2026', localFileKey: 'vault-a' }),
    document({ id: 'd2', title: 'Registration', type: 'Registration', storagePath: 'ws/h1/reg.pdf' }),
    document({ id: 'd3', title: 'Ownership Memo', type: 'Ownership Memo' }),
  ]);

  assert.deepEqual(
    plan.attach.map((record) => record.id),
    ['d1'],
  );
  // The two reasons are deliberately different: one is recoverable by signing
  // in, the other means the record never had a file. Telling a seller to sign
  // in to retrieve a file that does not exist wastes their evening.
  assert.deepEqual(plan.excluded, [
    { title: 'Registration: Registration', reason: 'stored in cloud storage, not on this device' },
    { title: 'Ownership Memo: Ownership Memo', reason: 'no file was attached to this record' },
  ]);
});

test('nothing is dropped silently — every selected document is either in or explained', async () => {
  const restore = installFakeIndexedDb();
  try {
    const documents = [];
    for (let index = 0; index < 25; index += 1) {
      const key = await storeLocalFile(new Blob(['x']), `doc-${index}.pdf`, undefined, TEST_WORKSPACE);
      documents.push(document({ id: `d${index}`, title: `Doc ${index}`, localFileKey: key }));
    }

    // The count binds on files that actually resolved, so it is asserted where
    // it is now applied.
    const { attachments, unattached } = await resolvePacketAttachments(documents, TEST_WORKSPACE);

    assert.equal(attachments.length, MAX_PACKET_ATTACHMENTS);
    assert.equal(attachments.length + unattached.length, documents.length);
    assert.match(unattached[0].reason, /over the 20-document packet limit/);
  } finally {
    restore();
  }
});

test('unreadable records do not spend the slots that readable files need', async () => {
  const restore = installFakeIndexedDb();
  try {
    // Twenty dangling keys — a partial restore leaves exactly this — followed
    // by one real file. Spending a slot before reading meant the good document
    // was reported over-limit and the packet embedded nothing at all.
    const documents = Array.from({ length: MAX_PACKET_ATTACHMENTS }, (_, index) =>
      document({ id: `stale${index}`, title: `Stale ${index}`, localFileKey: `vault-missing-${index}` }),
    );
    const key = await storeLocalFile(new Blob(['%PDF-1.4 REAL']), 'real.pdf', undefined, TEST_WORKSPACE);
    documents.push(document({ id: 'real', title: 'Real', localFileKey: key }));

    const { attachments, unattached } = await resolvePacketAttachments(documents, TEST_WORKSPACE);

    assert.deepEqual(
      attachments.map((item) => item.fileName),
      ['real.pdf'],
    );
    assert.equal(unattached.length, MAX_PACKET_ATTACHMENTS);
    assert.ok(
      unattached.every((entry) => /no longer on this device/.test(entry.reason)),
      'the stale records must be reported as missing, not as over-limit',
    );
  } finally {
    restore();
  }
});

test('the byte ceiling stops at the file that would cross it, not at the first big one', async () => {
  const restore = installFakeIndexedDb();
  try {
    const small = await storeLocalFile(new Blob(['a'.repeat(400)]), 'coggins.pdf', undefined, TEST_WORKSPACE);
    const huge = await storeLocalFile(new Blob(['b'.repeat(5_000)]), 'video.mp4', undefined, TEST_WORKSPACE);
    const alsoSmall = await storeLocalFile(new Blob(['c'.repeat(400)]), 'memo.pdf', undefined, TEST_WORKSPACE);

    const { attachments, unattached } = await resolvePacketAttachments(
      [
        document({ id: 'small', title: 'Coggins', localFileKey: small }),
        document({ id: 'huge', title: 'Video', type: 'Media Kit', localFileKey: huge }),
        // Still fits in what is left, so it must not be excluded just because a
        // bigger file came before it.
        document({ id: 'also-small', title: 'Memo', type: 'Ownership Memo', localFileKey: alsoSmall }),
      ],
      TEST_WORKSPACE,
      { maxBytes: 1_000 },
    );

    assert.deepEqual(
      attachments.map((item) => item.fileName),
      ['coggins.pdf', 'memo.pdf'],
    );
    assert.deepEqual(unattached, [{ title: 'Media Kit: Video', reason: 'too large to include in this packet' }]);
  } finally {
    restore();
  }
});

test('a file with no recorded size is still eligible', () => {
  // Refusing a real document over a missing metadata field would drop it from a
  // packet for no reason the seller could see or fix. `fileSizeBytes` is
  // optional and the vault read is what decides.
  const plan = planPacketAttachments([document({ id: 'd1', title: 'Coggins', localFileKey: 'vault-a' })]);

  assert.deepEqual(
    plan.attach.map((record) => record.id),
    ['d1'],
  );
});

test('the resolved attachment carries the bytes, not a reference to them', async () => {
  const restore = installFakeIndexedDb();
  try {
    const key = await storeLocalFile(
      new Blob(['%PDF-1.4 COGGINS'], { type: 'application/pdf' }),
      'coggins-2026.pdf',
      undefined,
      TEST_WORKSPACE,
    );
    const { attachments, unattached } = await resolvePacketAttachments(
      [document({ id: 'd1', title: 'Coggins 2026', localFileKey: key, fileName: 'coggins-2026.pdf' })],
      TEST_WORKSPACE,
    );

    assert.deepEqual(unattached, []);
    assert.equal(attachments.length, 1);
    assert.equal(attachments[0].label, 'Coggins: Coggins 2026');
    assert.equal(attachments[0].fileName, 'coggins-2026.pdf');
    // A `data:` URL is what makes the packet one file. A buyer gets it by
    // email, on a USB stick, or on a phone; a link to anything else does not
    // survive that.
    assert.ok(attachments[0].dataUrl.startsWith('data:application/pdf;base64,'));
    assert.equal(Buffer.from(attachments[0].dataUrl.split(',')[1], 'base64').toString(), '%PDF-1.4 COGGINS');
  } finally {
    restore();
  }
});

test('a key whose bytes are gone is reported, not quietly omitted', async () => {
  const restore = installFakeIndexedDb();
  try {
    const { attachments, unattached } = await resolvePacketAttachments(
      [document({ id: 'd1', title: 'Coggins 2026', localFileKey: 'vault-cleared' })],
      TEST_WORKSPACE,
    );

    assert.deepEqual(attachments, []);
    assert.deepEqual(unattached, [
      { title: 'Coggins: Coggins 2026', reason: 'the stored file is no longer on this device' },
    ]);
  } finally {
    restore();
  }
});

test('a file larger than one conversion chunk survives intact', async () => {
  const restore = installFakeIndexedDb();
  try {
    // Past 0x8000 bytes the conversion has to chunk. Spreading a whole file
    // into one `String.fromCharCode` call overflows the argument limit and
    // fails as a RangeError, which reads like a corrupt scan rather than a size
    // problem — and a Coggins photographed on a phone clears this easily.
    const original = Buffer.from(Array.from({ length: 0x8000 * 3 + 517 }, (_, index) => index % 256));

    const key = await storeLocalFile(
      new Blob([original], { type: 'image/jpeg' }),
      'coggins-scan.jpg',
      undefined,
      TEST_WORKSPACE,
    );
    const { attachments, unattached } = await resolvePacketAttachments(
      [document({ id: 'd1', title: 'Coggins scan', localFileKey: key })],
      TEST_WORKSPACE,
    );

    assert.deepEqual(unattached, []);
    const decoded = Buffer.from(attachments[0].dataUrl.split(',')[1], 'base64');
    assert.equal(decoded.length, original.length);
    assert.ok(decoded.equals(original), 'the bytes must round-trip exactly, not merely be the right length');
  } finally {
    restore();
  }
});

test('a file with no recorded type still gets a usable data URL', async () => {
  const restore = installFakeIndexedDb();
  try {
    const key = await storeLocalFile(new Blob(['scan']), 'scan.bin', undefined, TEST_WORKSPACE);
    const { attachments } = await resolvePacketAttachments(
      [document({ id: 'd1', title: 'Scan', localFileKey: key })],
      TEST_WORKSPACE,
    );

    // A `data:;base64,` URL with an empty type is not reliably openable, so an
    // unknown type falls back to the generic binary one rather than to nothing.
    assert.ok(attachments[0].dataUrl.startsWith('data:application/octet-stream;base64,'));
  } finally {
    restore();
  }
});

test('the byte ceiling binds on the bytes the vault holds, not on recorded sizes', async () => {
  const restore = installFakeIndexedDb();
  try {
    // Neither record carries `fileSizeBytes`, so the planner budgets both at
    // zero and lets them through — deliberately, since refusing a real document
    // over a missing metadata field would drop it for no visible reason. That
    // made the cap advisory: enough size-less records could produce a base64
    // packet of any size at all, which is a tab running out of memory rather
    // than a document.
    const first = await storeLocalFile(new Blob(['aaaaaa']), 'first.pdf', undefined, TEST_WORKSPACE);
    const second = await storeLocalFile(new Blob(['bbbbbb']), 'second.pdf', undefined, TEST_WORKSPACE);

    const plan = planPacketAttachments([
      document({ id: 'd1', title: 'First', localFileKey: first }),
      document({ id: 'd2', title: 'Second', localFileKey: second }),
    ]);
    assert.equal(plan.attach.length, 2, 'the planner must let both through, or this proves nothing');

    const { attachments, unattached } = await resolvePacketAttachments(
      [
        document({ id: 'd1', title: 'First', localFileKey: first }),
        document({ id: 'd2', title: 'Second', localFileKey: second }),
      ],
      TEST_WORKSPACE,
      { maxBytes: 8 },
    );

    assert.deepEqual(
      attachments.map((item) => item.fileName),
      ['first.pdf'],
    );
    // Excluded, not silently dropped — and with the planner's own wording, since
    // the seller does not care which pass measured it.
    assert.deepEqual(unattached, [{ title: 'Coggins: Second', reason: 'too large to include in this packet' }]);
  } finally {
    restore();
  }
});
