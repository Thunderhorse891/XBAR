import assert from 'node:assert/strict';
import test from 'node:test';
import { canSaveFilesLocally, saveBlobAsFile, saveTextAsFile } from '../src/lib/fileDownload.js';
import { legalDocumentToHtml, legalDocuments } from '../src/lib/legalDocuments.js';

// iOS WKWebView ignores an anchor's `download` attribute, so the old inline
// pattern (create blob URL, click anchor, toast "downloaded") produced no file
// and no error in a store build. These assert the saver reports that instead of
// pretending, and that the document helpers pass the result through so callers
// can show it.

type CapacitorWindow = { Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string } };

function asNativeApp(run: () => void) {
  const globals = globalThis as { window?: CapacitorWindow };
  const had = 'window' in globals;
  const previous = globals.window;
  globals.window = { Capacitor: { isNativePlatform: () => true, getPlatform: () => 'ios' } };
  try {
    run();
  } finally {
    if (had) globals.window = previous;
    else delete globals.window;
  }
}

test('a store build refuses the save and explains why, rather than silently doing nothing', () => {
  asNativeApp(() => {
    const result = saveBlobAsFile('packet.html', new Blob(['<p>packet</p>'], { type: 'text/html' }));
    assert.equal(result.ok, false);
    assert.ok(!result.ok && /browser/i.test(result.reason), 'reason should point the user at a browser');
    assert.equal(canSaveFilesLocally(), false);
  });
});

test('saveTextAsFile carries the same refusal', () => {
  asNativeApp(() => {
    const result = saveTextAsFile('backup.json', '{}', 'application/json');
    assert.equal(result.ok, false);
  });
});

test('the legal document export propagates the failure instead of reporting success', () => {
  asNativeApp(() => {
    const result = saveTextAsFile(
      legalDocuments[0].suggestedFileName,
      legalDocumentToHtml(legalDocuments[0]),
      'text/html;charset=utf-8',
    );
    assert.equal(result.ok, false);
    assert.ok(!result.ok && result.reason.length > 0);
  });
});

test('outside a browser there is no save path, and it says so rather than throwing', () => {
  // No window, no document: the node/SSR case. It must return a result, never
  // throw, because callers render its reason in a toast.
  const result = saveTextAsFile('x.json', '{}', 'application/json');
  assert.equal(result.ok, false);
  assert.equal(canSaveFilesLocally(), false);
});
