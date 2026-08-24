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
