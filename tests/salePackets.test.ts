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
    /digest: sha256\(file\.dataUrl\.slice\(file\.dataUrl\.indexOf\(','\) \+ 1\)\)/,
    'each attachment must be fingerprinted by its bytes',
  );
  assert.match(
    generator,
    /attachments: params\.attachments,/,
    'the packet must pass its embedded files to the credential',
  );
  assert.match(
    generator,
    /and the contents of \$\{attachments\.length/,
    'the seal note must say the file contents are covered',
  );
});
