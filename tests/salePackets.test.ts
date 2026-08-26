import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('sale packets page builds real packets — no fake share links or toast-only sharing', async () => {
  const source = await readFile('src/routes/SalePacketStudio.tsx', 'utf8');
  assert.doesNotMatch(source, /xbar\.app\/packet/, 'hard-coded fake packet URL must not return');
  assert.match(source, /SalePacketWizard/, 'packet creation must go through the real wizard (createSalePacketBuild)');
  assert.match(source, /salePacketBuilds/, 'page must list persisted packet records');
});

test('buyer revoke persists a buyer event, not only telemetry', async () => {
  const source = await readFile('src/routes/BuyerDealRoom.tsx', 'utf8');
  assert.match(
    source,
    /logBuyerRoomEvent\(\{[^}]*kind: 'deal-status'/s,
    'revoking access must log a persisted buyer event',
  );
});

test('a buyer watermark fits the page and is still legible on it', async () => {
  const source = await readFile('src/lib/localSalePacketGenerator.ts', 'utf8');

  assert.match(
    source,
    /const watermarkSize = watermark\.length <= 8 \? '78px' : 'clamp\(32px, 5vw, 54px\)'/,
    'a long buyer watermark must step down in size rather than run off the page',
  );
  // Shrinking to fit was the tempting fix and the wrong one: at 6% opacity a
  // 20px mark is invisible on paper, so a long mark wraps inside a bounded
  // width instead.
  assert.match(source, /\.watermark\{[^}]*width:74vw/, 'the mark must be bounded by the page, not by nowrap');
  assert.doesNotMatch(source, /\.watermark\{[^}]*white-space:nowrap/, 'a bounded mark has to be allowed to wrap');
  assert.match(
    source,
    /<div class="watermark">\$\{escapeHtml\(watermark\)\}<\/div>/,
    'the watermark is buyer-supplied text and must be escaped',
  );
});

test('a packet with no watermark still carries one', async () => {
  const source = await readFile('src/lib/localSalePacketGenerator.ts', 'utf8');

  assert.match(
    source,
    /const watermark = params\.watermark\?\.trim\(\) \|\| 'XBAR';/,
    'an unwatermarked packet is the outcome this field exists to prevent',
  );
});

test('a document type buyers may not see is never offered, selected, or embedded', async () => {
  const generator = await readFile('src/lib/localSalePacketGenerator.ts', 'utf8');
  const wizard = await readFile('src/components/SalePacketWizard.tsx', 'utf8');

  // `Breeding Contract` is a commercial agreement with a third party. It is a
  // Ready document on the horse, so it was ticked by default and — once the
  // packet started embedding files — its full contents were sent to a stranger
  // under the heading "approved documents".
  assert.doesNotMatch(
    generator,
    /const buyerSafeDocumentTypes = new Set<DocumentRecord\['type'\]>\(\[[^\]]*'Breeding Contract'/s,
    'a breeding contract must not be classified buyer-safe',
  );

  // The function named itself buyer-safe and returned every Ready document with
  // a flag nothing downstream read.
  assert.match(
    generator,
    /record\.state === 'Ready' && isBuyerSafeDocumentType\(record\.type\)/,
    'the buyer-safe set must withhold, not merely flag',
  );

  assert.match(
    wizard,
    /document\.state === 'Ready' && isBuyerSafeDocumentType\(document\.type\)/,
    'the wizard must not offer or default-select a document buyers may not see',
  );
});

test('the packet seal covers the bytes of every embedded file', async () => {
  const generator = await readFile('src/lib/localSalePacketGenerator.ts', 'utf8');

  // Without this the seal covers document TITLES while the packet carries the
  // documents: swap the base64 behind "Coggins 2026" and every sealed fact
  // still matches, under a note telling the buyer a matching code proves the
  // packet is unaltered.
  assert.match(
    generator,
    /digest: sha256Bytes\(base64ToBytes\(file\.dataUrl\.slice\(file\.dataUrl\.indexOf\(','\) \+ 1\)\)\)/,
    'each attachment must be fingerprinted by its decoded bytes, so `shasum -a 256` on the saved file prints the recorded digest',
  );
  assert.match(
    generator,
    /attachments: params\.attachments,/,
    'the packet must pass its embedded files to the credential',
  );
  assert.match(
    generator,
    /and the bytes of \$\{attachments\.length/,
    'the seal note must say the file contents are covered',
  );
});

test('the packet publishes what it was sealed from', async () => {
  const generator = await readFile('src/lib/localSalePacketGenerator.ts', 'utf8');

  /*
   * A seal nobody can recompute is decoration. The packet printed a code and a
   * digest and told the buyer that comparing the code with the seller's proved
   * the packet unaltered — but published neither the sealed record nor any way
   * to rehash the embedded files, so swapping an attachment and leaving the
   * printed code alone passed the buyer's instructed check.
   */
  assert.match(
    generator,
    /<pre class="verify__payload" id="xbar-credential-payload">\$\{escapeHtml\(credential\.payload\)\}<\/pre>/,
    'the sealed record itself must be published, or the digest cannot be recomputed',
  );
  assert.match(
    generator,
    /data-xbar-file="\$\{escapeHtml\(file\.id\)\}"/,
    'each embedded file must be identifiable so it can be matched to its sealed entry',
  );
});

test('the packet rehashes its own files rather than trusting the printed seal', async () => {
  // The script lives in its own module now: a CSP hash covers exact bytes, so
  // isolating those bytes gives the hash one obvious source.
  const script = await readFile('src/lib/packetVerifierScript.ts', 'utf8');

  assert.match(script, /crypto\.subtle\.digest\('SHA-256'/, 'the check must actually hash');
  assert.match(
    script,
    /querySelectorAll\('a\[data-xbar-file\]'\)/,
    'the files must be read out of the page, not taken from the record they are being checked against',
  );
  assert.match(
    script,
    /is not the one that was sealed/,
    'a swapped attachment must be reported, which is the attack the seal exists to catch',
  );
  assert.match(
    script,
    /was sealed but is missing from this packet/,
    'a removed attachment must be reported too — dropping the inconvenient file is the cheaper forgery',
  );

  /*
   * The facts are read back OUT of the sealed record. Everything printed above
   * the seal — the ask price, the transfer status, even the "Sealed facts"
   * list — is ordinary editable HTML, and editing it alone leaves the digest
   * intact. Printing what the digest actually covers is what makes that edit
   * visible to the buyer.
   */
  assert.match(script, /Every fact this seal covers, read out of the sealed record/);
  // Every field, walked generically. A curated list let an attacker edit any
  // fact that was not on it — breed, colour, owner entity, a document title —
  // while the digest still matched and the check still said pass.
  assert.match(script, /describe\(notes, parsed, ' {2}'\);/, 'the whole sealed payload must be rendered');
});

test('the packet no longer claims that reading the seal proves anything', async () => {
  const generator = await readFile('src/lib/localSalePacketGenerator.ts', 'utf8');

  /*
   * The old copy: "Compare this seal code with the one the seller gives you
   * directly: if they match, the packet is unaltered." False. The code is text
   * in the file; whoever swapped an attachment could leave it untouched, and
   * the buyer's comparison still matched.
   */
  assert.doesNotMatch(
    generator,
    /if they match, the packet is unaltered/,
    'the packet must not promise that comparing two printed strings proves anything',
  );
  assert.match(generator, /Reading the code above proves nothing by itself/);
  assert.match(
    generator,
    /this does not trust the button above/,
    'the by-hand route must be offered, because the in-page script is as editable as the rest of the file',
  );
  assert.match(generator, /shasum -a 256/, 'the by-hand steps must name a tool the buyer already has');
});
