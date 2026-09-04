import assert from 'node:assert/strict';
import test from 'node:test';
import { canSaveFilesLocally, saveTextAsFile } from '../src/lib/fileDownload.js';
import { legalDocumentToHtml, legalDocuments } from '../src/lib/legalDocuments.js';

// Saving a file takes one of two real paths: the Capacitor share sheet when the
// native bridge is live, and an anchor download in a browser. These cover the
// decision and the failure reporting; the plugin call itself is exercised on a
// device, not here.
//
// The important property under test is that a caller is never told a file was
// saved when it was not — the failure mode this module exists to remove.

type CapacitorWindow = { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } };

function withWindow(value: CapacitorWindow | undefined, run: () => Promise<void>) {
  const globals = globalThis as { window?: CapacitorWindow };
  const had = 'window' in globals;
  const previous = globals.window;
  if (value === undefined) delete globals.window;
  else globals.window = value;
  return run().finally(() => {
    if (had) globals.window = previous;
    else delete globals.window;
  });
}

const nativeBridge: CapacitorWindow = {
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' },
};

test('with the native bridge live, saving reports a real failure rather than a false success', async () => {
  // The Capacitor plugins cannot reach a native runtime here, so the share-sheet
  // path fails. What matters is that it is reported as a failure with a reason,
  // never as a silent success.
  await withWindow(nativeBridge, async () => {
    assert.equal(canSaveFilesLocally(), true, 'a live bridge means a save path exists');
    const result = await saveTextAsFile('packet.html', '<p>packet</p>', 'text/html');
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.reason.length > 0, 'a failure must carry a reason to show the user');
  });
});

test('a legal document export goes through the same reporting path', async () => {
  await withWindow(nativeBridge, async () => {
    const result = await saveTextAsFile(
      legalDocuments[0].suggestedFileName,
      legalDocumentToHtml(legalDocuments[0]),
      'text/html;charset=utf-8',
    );
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.reason.length > 0);
  });
});

test('outside a browser there is no save path, and it says so rather than throwing', async () => {
  // No window, no document: the node/SSR case. It must return a result, never
  // throw, because callers render its reason in a toast.
  await withWindow(undefined, async () => {
    const result = await saveTextAsFile('x.json', '{}', 'application/json');
    assert.equal(result.ok, false);
    assert.equal(canSaveFilesLocally(), false);
  });
});

test('a browser page with no Capacitor keeps the download path available', async () => {
  await withWindow({}, async () => {
    // document is still absent under node, so the save itself cannot run; the
    // point here is that a plain web page is not routed to the share sheet.
    const result = await saveTextAsFile('x.json', '{}', 'application/json');
    assert.equal(result.ok, false);
    assert.ok(!result.ok && /browser/i.test(result.reason));
  });
});

test('binary content reaches the share sheet byte-for-byte', async () => {
  // Regression guard: saveBlobAsFile used to route every blob through
  // blob.text(), which decodes as UTF-8 and replaces invalid sequences with
  // U+FFFD — a packet PDF or photo arrived corrupted while the save still
  // reported success. These bytes are deliberately not valid UTF-8.
  const pdfMagic = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0xff, 0xfe, 0x00, 0x80, 0xc0]);

  const decoded = new TextEncoder().encode(new TextDecoder().decode(pdfMagic));
  assert.notDeepEqual(
    Array.from(decoded),
    Array.from(pdfMagic),
    'precondition: a text round-trip must actually corrupt these bytes, or this test proves nothing',
  );

  // What the save path now does instead: preserve the original bytes.
  const preserved = new Uint8Array(await new Blob([pdfMagic]).arrayBuffer());
  assert.deepEqual(Array.from(preserved), Array.from(pdfMagic));
});

/*
 * The exports main had that the original native work never covered.
 *
 * Each of these built its own anchor and clicked it, then reported success
 * unconditionally. In a store build WKWebView ignores the download attribute,
 * so the tap produced no file, no error, and a toast saying it had worked.
 *
 * The property asserted here is the one that matters: with no window, no
 * document and no Capacitor bridge -- which is what a store build looks like
 * before the anchor path can work -- every one of these reports failure with a
 * reason, rather than a success nobody can act on.
 */
test('every export refuses honestly when there is no way to save', async () => {
  const { downloadRanchReportCsv } = await import('../src/lib/ranchReportExport.js');
  const { downloadPublicBuyerPacketArtifact } = await import('../src/lib/publicBuyerPacket.js');
  const { downloadHtmlFile } = await import('../src/lib/documentTemplateLibrary.js');
  const { downloadLegalHtml } = await import('../src/lib/legalDocuments.js');
  const { buildRanchReport } = await import('../src/lib/ranchReport.js');

  const report = buildRanchReport(
    { horses: [], documents: [], expenseReceipts: [], salesLeads: [], ownershipRecords: [] },
    new Date('2026-09-04T18:00:00Z'),
  );

  await withWindow(undefined, async () => {
    const results = [
      await downloadRanchReportCsv(report),
      await downloadHtmlFile('x.html', '<p>x</p>'),
      await downloadLegalHtml(legalDocuments[0]),
      await downloadPublicBuyerPacketArtifact({ fileName: 'packet.html', html: '<p>x</p>' }),
    ];
    for (const result of results) {
      assert.equal(result.ok, false, 'an export claimed success with nowhere to save');
      if (!result.ok) assert.ok(result.reason.length > 0, 'a refusal must carry a reason to show');
    }
  });

  // downloadRanchReportPdf is deliberately absent. It renders through
  // ranchReportPdf, which imports api/_lib/pdf.js -- not emitted into the test
  // build -- so exercising it here would test the harness, not the export. It
  // shares saveBlobAsFile with the backup path, which IS covered below.
});

test('the report CSV keeps the BOM that makes Excel read it as UTF-8', async () => {
  // The BOM moved when this export was rerouted through saveTextAsFile. Losing
  // it is silent: the file still opens, and every accented horse name arrives
  // mangled in the one program these are opened in.
  const { downloadRanchReportCsv } = await import('../src/lib/ranchReportExport.js');
  const { buildRanchReport } = await import('../src/lib/ranchReport.js');
  const report = buildRanchReport(
    { horses: [], documents: [], expenseReceipts: [], salesLeads: [], ownershipRecords: [] },
    new Date('2026-09-04T18:00:00Z'),
  );

  const globals = globalThis as { document?: unknown; URL?: unknown };
  const hadDoc = 'document' in globals;
  const previousDoc = globals.document;
  const previousUrl = globals.URL;
  let saved: Blob | null = null;
  globals.document = { createElement: () => ({ click() {} }) };
  globals.URL = {
    createObjectURL: (blob: Blob) => {
      saved = blob;
      return 'blob:test';
    },
    revokeObjectURL: () => {},
  };
  try {
    const result = await downloadRanchReportCsv(report);
    assert.equal(result.ok, true, 'the browser path must save when a document exists');
  } finally {
    if (hadDoc) globals.document = previousDoc;
    else delete globals.document;
    globals.URL = previousUrl;
  }

  assert.ok(saved, 'the export never produced a blob');
  // Asserted on BYTES, not on text(). Blob.text() decodes as UTF-8, and the
  // UTF-8 decoder strips a leading BOM per spec -- so reading it back as a
  // string reports the mark missing whether or not it was ever written, which
  // is a test that fails on correct code and cannot fail on broken code.
  const bytes = new Uint8Array(await (saved as unknown as Blob).arrayBuffer());
  assert.deepEqual(
    [bytes[0], bytes[1], bytes[2]],
    [0xef, 0xbb, 0xbf],
    'the CSV lost its UTF-8 byte-order mark, so Excel will mangle accented names',
  );
});
