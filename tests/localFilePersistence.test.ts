import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

/*
 * The wiring, asserted at the source.
 *
 * The defect these guard against was not a wrong value — it was a branch that
 * did nothing. `const localFileUrl = undefined;` sat directly under
 * `console.error('Cloud upload failed; storing file locally instead.')`, so
 * every unit test of the surrounding function passed while the file's bytes
 * were discarded. Nothing short of reading the call site catches that.
 */

test('a document the cloud did not take is stored on this device', async () => {
  const source = await readFile('src/store/useXbarStore.ts', 'utf8');

  assert.doesNotMatch(
    source,
    /const localFileUrl = undefined;/,
    'the dead local-file assignment must not return — it stored nothing while claiming to',
  );
  assert.match(
    source,
    /if \(!uploadedAsset\) \{\s*try \{\s*localFileKey = await storeLocalFile\(file, file\.name, file\.type\)/,
    'a document the cloud declined must have its bytes written to the on-device vault',
  );
  assert.match(
    source,
    /localFileKey,\s*\n\s*storagePath: uploadedAsset\?\.storagePath,/,
    'the record must carry the vault key',
  );
});

test('a receipt the cloud did not take is stored on this device', async () => {
  const source = await readFile('src/store/useXbarStore.ts', 'utf8');

  assert.match(
    source,
    /if \(input\.file && !uploadedAsset\) \{\s*try \{\s*localFileKey = await storeLocalFile\(\s*input\.file/,
    'a receipt the cloud declined must have its bytes written to the on-device vault',
  );
});

test('only files nobody can open are reported as metadata only', async () => {
  const source = await readFile('src/store/useXbarStore.ts', 'utf8');

  // A document held in the vault opens on this device. Counting it as
  // "metadata only" would report a data-loss event that did not happen.
  assert.match(
    source,
    /const localDocumentCount = documents\.filter\(\s*\(document\) => !document\.storagePath && !document\.localFileKey,\s*\)\.length;/,
    'the metadata-only count must exclude documents held in the on-device vault',
  );
});

test('the vault is consulted before cloud storage when opening a file', async () => {
  const source = await readFile('src/lib/cloudWorkspace.ts', 'utf8');

  const resolver = source.slice(source.indexOf('export async function getDocumentAccessUrl'));
  const vaultAt = resolver.indexOf('openLocalFile');
  const signedUrlAt = resolver.indexOf('createSignedUrl');

  assert.ok(vaultAt > -1, 'the resolver must know about locally held files');
  assert.ok(
    vaultAt < signedUrlAt,
    'a local file needs no session and no network, so it must be resolved before a signed URL is requested',
  );
  assert.match(
    resolver,
    /saved on a different device or browser/,
    'a key with no bytes behind it must say so rather than showing a broken link',
  );
});

test('the vault is reconciled against the workspace on rehydration', async () => {
  const source = await readFile('src/store/useXbarStore.ts', 'utf8');

  assert.match(
    source,
    /onRehydrateStorage: \(\) => \(state\) => \{[\s\S]*sweepLocalFileVault\(\s*referencedVaultKeys\(state\.documents, state\.expenseReceipts, state\.salePacketBuilds\),?\s*\)/,
    'file bytes must be reclaimed when the records that referenced them are gone',
  );
});

test('a workspace with no cloud identity still produces a packet', async () => {
  const source = await readFile('src/components/SalePacketWizard.tsx', 'utf8');

  assert.match(
    source,
    /if \(hasBackendIdentity\(auth\)\) \{[\s\S]*?\} else \{[\s\S]*?localPacket = buildLocalSalePacket\(\{/,
    'the no-cloud branch must render a packet, not record a row and tell the seller to sign in',
  );
  assert.match(
    source,
    /storeLocalFile\(\s*new Blob\(\[localPacket\.html\], \{ type: 'text\/html' \}\)/,
    'the generated packet must be kept on this device, not only as an object URL',
  );
  assert.doesNotMatch(
    source,
    /Cloud sign-in generates the watermarked PDF/,
    'a seller holding a finished packet must not be told to sign in to get one',
  );
});

test('the stored seal is the one printed on the packet', async () => {
  const wizard = await readFile('src/components/SalePacketWizard.tsx', 'utf8');
  const store = await readFile('src/store/useXbarStore.ts', 'utf8');

  assert.match(
    wizard,
    /localSeal = \{ \.\.\.localPacket\.credential, anchor: 'local' as const \}/,
    'the wizard must hand over the credential it rendered into the document',
  );
  assert.match(
    store,
    /input\.localSeal\s*\?[\s\S]{0,600}\{ \.\.\.input\.localSeal, anchor: 'local' \}/,
    'the store must persist that credential rather than sealing the same records a second time',
  );
});

test('a locally generated packet is named for what it actually is', async () => {
  const store = await readFile('src/store/useXbarStore.ts', 'utf8');

  assert.match(
    store,
    /fileName: input\.fileName \?\? `sale-packet-\$\{slug\}-\$\{todayStamp\(\)\}\.pdf`/,
    'an HTML packet must not be handed to a buyer named .pdf',
  );
});

test('a stored packet is reachable after a reload', async () => {
  for (const path of ['src/routes/SalePacketStudio.tsx', 'src/routes/Documents.tsx']) {
    const source = await readFile(path, 'utf8');
    assert.match(
      source,
      /packet\.localFileKey \?[\s\S]{0,700}openPacket\(packet\)/,
      `${path} must resolve a locally held packet through the vault`,
    );
  }
});

test('every screen decides "is there a file" the same way', async () => {
  for (const path of ['src/routes/Documents.tsx', 'src/routes/Expenses.tsx']) {
    const source = await readFile(path, 'utf8');
    assert.match(source, /hasStoredFile\(/, `${path} must use the shared predicate`);
    // Three hand-written copies of this expression is how the vault came to be
    // offered in one list and hidden in another.
    assert.doesNotMatch(source, /\.fileUrl \|\| \w+\.storagePath/, `${path} must not hand-roll the has-a-file test`);
  }
});

test('a receipt scan can be opened, not just counted', async () => {
  const source = await readFile('src/routes/Expenses.tsx', 'utf8');

  assert.match(
    source,
    /const openReceiptFile = async \(receipt: ExpenseReceipt\) => \{[\s\S]*openStoredFileInTab\(receipt\)/,
    'the evidence behind a number an accountant will ask about must be viewable',
  );
});
