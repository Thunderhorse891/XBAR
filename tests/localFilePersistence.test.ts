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
    /if \(!uploadedAsset\) \{\s*try \{\s*localFileKey = await storeLocalFile\(file, file\.name, file\.type, vaultOwnerId\(\)\)/,
    'a document the cloud declined must have its bytes written to the on-device vault, tagged with the workspace that owns it',
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
    /onRehydrateStorage: \(\) => \(state\) => \{[\s\S]*onWorkspaceSettled\(\(\) => \{[\s\S]{0,400}sweepLocalFileVault\(/,
    'file bytes must be reclaimed when the records that referenced them are gone — but only this workspace\u2019s, since the vault is origin-wide and another account\u2019s files are not orphans',
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

test('a locally generated packet contains the documents it lists', async () => {
  const wizard = await readFile('src/components/SalePacketWizard.tsx', 'utf8');
  const generator = await readFile('src/lib/localSalePacketGenerator.ts', 'utf8');

  assert.match(
    wizard,
    /const resolved = await resolvePacketAttachments\(/,
    'the no-cloud branch must read the selected documents, not just their titles',
  );
  assert.match(
    wizard,
    /attachments: resolved\.attachments,\s*unattached: resolved\.unattached,/,
    'both halves must reach the packet — what is in it and what is not',
  );
  assert.match(
    generator,
    /<a data-xbar-file="\$\{escapeHtml\(file\.id\)\}" download="\$\{escapeHtml\(file\.fileName\)\}" href="\$\{escapeHtml\(file\.dataUrl\)\}"/,
    'each attached file must be openable from the packet itself, and identifiable so the seal check can match it to its sealed entry',
  );
  assert.match(
    generator,
    /Not included in this packet:/,
    'a document that could not be embedded must be named on the page, not omitted',
  );
});

test('the seller is told how much of the packet is actually in it', async () => {
  const source = await readFile('src/components/SalePacketWizard.tsx', 'utf8');

  // "N of M documents embedded" is the difference between the seller finding a
  // missing Coggins now and the buyer finding it.
  assert.match(
    source,
    /\$\{localPacket\?\.attachedFiles \?\? 0\} of \$\{docSelection\.length\} document/,
    'the confirmation must state how many of the selected documents were embedded',
  );
  assert.match(
    source,
    /localPacket\?\.unattachedDocuments\.length\s*\?\s*'Sale packet ready — some files not included'/,
    'an incomplete packet must not be announced as simply ready',
  );
});

test('a blocked tab is reported, not counted as opened', async () => {
  const source = await readFile('src/lib/openStoredFile.ts', 'utf8');

  // The fallback runs after an await, so the click no longer counts as user
  // activation and this is the attempt most likely to be blocked. Its return
  // value is the only signal that happened — and the wizard tells the seller
  // their packet is open in a new tab on the strength of it.
  assert.match(
    source,
    /const opened = typeof window === 'undefined' \? null : window\.open\(/,
    'the fallback window must be captured, not fired and forgotten',
  );
  assert.match(
    source,
    /if \(!opened\) \{[\s\S]{0,300}ok: false,/,
    'a blocked tab must return a failure the caller can show',
  );
  assert.match(
    source,
    /if \(!opened\) \{[\s\S]{0,200}release\?\.\(\);/,
    'nothing consumed the object URL, so it must be released immediately',
  );
});

test('the reports screen refreshes when the day changes, and exports are built fresh', async () => {
  const source = await readFile('src/routes/Reports.tsx', 'utf8');

  // Memoized on the data alone, a tab left open overnight kept yesterday's
  // generated date, "this month" totals, trailing window and anomalies.
  assert.match(source, /const dayKey = useDayKey\(\);/, 'the clock must be a dependency of the report');
  assert.match(source, /\[reportInput, dayKey\]/, 'the memo must recompute at the day boundary');

  // The exported file outlives the tab and carries a date a banker will read.
  assert.match(
    source,
    /downloadRanchReportPdf\(buildRanchReport\(reportInput\), workspaceProfile\.ranchName\)/,
    'the PDF export must build a report at the moment of export',
  );
  assert.match(
    source,
    /downloadRanchReportCsv\(buildRanchReport\(reportInput\)\)/,
    'the CSV export must build a report at the moment of export',
  );
});

test('the vault is never swept against a workspace that failed to read', async () => {
  const source = await readFile('src/store/useXbarStore.ts', 'utf8');

  /*
   * The worst thing in this whole area. A transient read failure hydrates the
   * empty initial state, so the reference set is empty while the vault still
   * holds every document the ranch owns — and the sweep would delete all of it
   * permanently, on a start-up that would have recovered on the next reload.
   */
  const guardAt = source.indexOf('didWorkspaceReadFail()');
  const sweepAt = source.indexOf('sweepLocalFileVault(');

  assert.ok(guardAt > -1, 'the sweep must know whether the workspace was actually read');
  assert.ok(guardAt < sweepAt, 'the guard must come before the sweep, not after it');
  assert.match(source, /if \(didWorkspaceReadFail\(\)\) return;/, 'a failed read must skip the sweep entirely');
});

test('both IndexedDB writers wait for the commit, not the request', async () => {
  // The same rule in two deliberately separate databases. Getting it right in
  // one and not the other is exactly what happened: the vault was fixed and the
  // workspace store kept resolving on `request.onsuccess` for another two
  // commits.
  for (const path of ['src/lib/localFileVault.ts', 'src/lib/workspaceStorage.ts']) {
    const source = await readFile(path, 'utf8');
    assert.match(
      source,
      /transaction\.oncomplete = \(\) => resolve\(result\);/,
      `${path} must resolve on the transaction's completion`,
    );
    // Scoped to the store helper: opening a DATABASE legitimately resolves on
    // its request, because there is no transaction involved in an open.
    assert.match(
      source,
      /request\.onsuccess = \(\) => \{\s*result = request\.result;\s*\};/,
      `${path} must hold the request's result rather than resolving with it`,
    );
    assert.match(source, /transaction\.onabort = /, `${path} must reject when the transaction is rolled back`);
  }
});

test('the packet summary does not claim a tab that never opened', async () => {
  const source = await readFile('src/components/SalePacketWizard.tsx', 'utf8');

  // The blocked-tab warning and the success summary were both firing: the
  // seller got "your browser blocked the new tab" immediately followed by
  // "opened in a new tab". This branch runs after attachment resolution and an
  // IndexedDB write, so the block is the common case, not the rare one.
  /*
   * Now three outcomes, not two. A blocked popup was the first way this claim
   * went wrong; a file delivered as a download rather than a tab is the second,
   * and a boolean could only ever describe one of them.
   */
  assert.match(
    source,
    /packetDelivery = opened\.ok \? opened\.delivery : 'none';/,
    'the wizard must record HOW the packet was delivered, not merely that it succeeded',
  );
  assert.match(
    source,
    /packetDelivery === 'tab' \? ' and opened in a new tab'/,
    'a tab may only be claimed when one actually opened',
  );
  assert.match(
    source,
    /packetDelivery === 'download' \? ' and downloaded to this device'/,
    'a download has to be described as a download',
  );
  assert.match(
    source,
    /' — open it from Sale packets when you are ready'/,
    'and a packet that reached neither must say where to find it',
  );
});

test('a refused file-vault purge is not reported as a completed deletion', async () => {
  const source = await readFile('src/routes/Settings.tsx', 'utf8');

  /*
   * The capture has to precede both state-clearing steps. `deleteAccount`
   * clears the cloud workspace id and `resetWorkspace` erases the records, so
   * reading either afterwards answered for a workspace that no longer existed:
   * every cloud deletion purged as 'local' with an empty key list, leaving the
   * deleted account's files behind and deleting the local-only workspace's
   * instead.
   */
  const capture = source.indexOf('const departingWorkspaceId = vaultOwnerId();');
  const del = source.indexOf('await deleteAccount(deleteConfirm)');
  const reset = source.indexOf('resetWorkspace();');
  assert.ok(capture > -1, 'the departing workspace must be captured');
  assert.ok(capture < del, 'before the account is deleted');
  assert.ok(capture < reset, 'and before the workspace is reset');

  // Scoped to this workspace now: the vault is origin-wide, so dropping the
  // database would take a second account's documents with it.
  assert.match(
    source,
    /const \{ cleared \} = await clearLocalFileVault\(departingWorkspaceId, departingKeys\);/,
    'the purge result must be read, and scoped to the workspace captured BEFORE deletion cleared it',
  );
  assert.match(
    source,
    /cleared \? 'Account deleted' : 'Account deleted — files still on this device'/,
    'files left on the device must not be described as permanently deleted',
  );
});

test('a throwing file lookup becomes a result, not an escaping rejection', async () => {
  const source = await readFile('src/lib/openStoredFile.ts', 'utf8');

  /*
   * The vault rejects when IndexedDB is unreadable, and the Supabase client has
   * its own ways to blow up. An escaping rejection breaks this helper's own
   * contract: the pre-opened blank tab stays on screen, and every caller keeps
   * its "Opening..." state forever, because all of them only handle
   * `{ ok: false }`.
   */
  assert.match(
    source,
    /try \{\s*access = await getDocumentAccessUrl\(record\);\s*\} catch \(error\) \{/,
    'resolution must be guarded',
  );
  assert.match(
    source,
    /\} catch \(error\) \{[\s\S]{0,300}previewWindow\?\.close\(\);[\s\S]{0,200}return \{ ok: false/,
    'the blank tab must be closed and a failure returned',
  );
});

test('the packet attachment cap is enforced against the vault, not against metadata', async () => {
  const source = await readFile('src/lib/localPacketAttachments.ts', 'utf8');

  // `fileSizeBytes` is optional and an absent one budgets as zero, so the
  // planner's cap alone was advisory.
  assert.match(
    source,
    /if \(usedBytes \+ entry\.size > maxBytes\) \{/,
    'the resolve pass must re-check the ceiling against real bytes',
  );
  assert.match(source, /usedBytes \+= entry\.size;/, 'and must accumulate them');
});

test('the cloud packet never claims a tab the browser refused', async () => {
  const wizard = await readFile('src/components/SalePacketWizard.tsx', 'utf8');

  /*
   * The cloud path had the same defect the local path was fixed for. It runs
   * after `createSalePacketRemote` awaited a network request, so the click no
   * longer counts as user activation and the popup is commonly refused — and
   * the `null` was discarded while the summary announced a PDF in a tab nobody
   * could see.
   */
  assert.match(
    wizard,
    /packetDelivery = window\.open\(downloadUrl, '_blank', 'noopener,noreferrer'\) \? 'tab' : 'none';/,
    'the cloud open must report whether a tab actually opened',
  );
  assert.match(wizard, /Packet ready — tab was blocked/, 'and say where to find the packet when it did not');
});

test('an import never grants a restored file script execution', async () => {
  const settings = await readFile('src/routes/Settings.tsx', 'utf8');
  const vault = await readFile('src/lib/localFileVault.ts', 'utf8');

  // Every signal available during an import comes from the archive, so none of
  // them may grant execution. Deriving it from the backup's own packet records
  // was the hole: normalization only requires a non-empty id.
  assert.ok(!settings.includes('generatedKeys'), 'the archive-derived provenance path must be gone');
  assert.match(vault, /generated: false,/, 'a restored file is download-only');
});

test('the sweep waits for cloud reconciliation, not just the workspace id', async () => {
  const store = await readFile('src/store/useXbarStore.ts', 'utf8');
  const helper = await readFile('src/lib/vaultOwner.ts', 'utf8');

  /*
   * `initialize` publishes the workspace id early; only afterwards does
   * CloudBootstrap load the remote backup and reconcile, which can REPLACE
   * every local record. Sweeping in between sees the new workspace's id beside
   * the previous workspace's documents — so reloading a browser that last
   * persisted workspace A while signed into B swept B's files against A's keys
   * and deleted them permanently, before B's records had loaded.
   */
  assert.match(helper, /if \(useCloudStore\.getState\(\)\.autosaveReady\) \{/, 'the gate is reconciliation, not init');
  assert.ok(
    !/getState\(\)\.initialized/.test(helper) && !/cloud\.initialized/.test(helper),
    'waiting on initialize is the bug, not the fix — the prose may mention it, the code may not read it',
  );

  // And the records swept against must be the ones that exist THEN, not the
  // snapshot captured at rehydration.
  assert.match(store, /onWorkspaceSettled\(\(\) => \{\s*const current = useXbarStore\.getState\(\);/);
  assert.match(store, /referencedVaultKeys\(current\.documents, current\.expenseReceipts, current\.salePacketBuilds\)/);
});
