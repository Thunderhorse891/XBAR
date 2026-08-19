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
