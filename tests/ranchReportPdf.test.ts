import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import test from 'node:test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { buildRanchReport, type RanchReportInput } from '../src/lib/ranchReport.js';
import { reportDecisions, reportException } from '../src/lib/ranchReportDecisions.js';
import { renderReportPdf } from '../src/lib/ranchReportPdf.js';

const now = new Date('2026-09-11T12:00:00Z');
function fixture(count = 18): RanchReportInput {
  const horses = Array.from({ length: count }, (_, i) => ({
    id: `h${i}`,
    name: i === 0 ? 'Thunderhorse Quarter Horse Champion' : `Synthetic Ranch Horse ${i + 1}`,
    status: 'Active',
    costBasis: 4000 + i * 225,
    readiness: { score: 80 },
    sale: { askPrice: 14000, listingState: 'Market Ready' },
  }));
  return {
    horses,
    expenseReceipts: horses.map((h, i) => ({
      id: `r${i}`,
      horseId: h.id,
      category: 'Feed',
      amount: 123.45 + i,
      receiptDate: '2026-09-02',
    })),
    documents: [],
    ownershipRecords: [],
    salesLeads: [],
  } as unknown as RanchReportInput;
}
const branding = async () => ({
  logo: await readFile('public/brand/xbar-report-horse.png'),
  mark: await readFile('public/brand/xbar-report-mark.png'),
  watermark: await readFile('public/brand/xbar-report-watermark.png'),
});

// Inspect actual PDF operators: no external rasterizer needed in CI.
function drawn(bytes: Uint8Array) {
  const raw = Buffer.from(bytes).toString('latin1');
  const result: { text: string; x: number; y: number; size: number; strong: boolean }[] = [];
  for (const match of raw.matchAll(/stream\r?\n/g)) {
    const start = match.index! + match[0].length;
    let ops: string;
    try {
      ops = inflateSync(Buffer.from(raw.slice(start, raw.indexOf('endstream', start)), 'latin1')).toString('latin1');
    } catch {
      continue;
    }
    let x = 0,
      y = 0,
      size = 0,
      strong = false;
    for (const line of ops.split('\n')) {
      const font = /^\/(\S+) ([\d.]+) Tf$/.exec(line.trim());
      if (font) {
        size = +font[2];
        strong = font[1].includes('Bold');
      }
      const pos = /^1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm$/.exec(line.trim());
      if (pos) {
        x = +pos[1];
        y = +pos[2];
      }
      const show = /^<([0-9A-Fa-f]*)> Tj$/.exec(line.trim());
      if (show)
        result.push({
          text: new TextDecoder('windows-1252').decode(Buffer.from(show[1], 'hex')).replace(/\u0099/g, '™'),
          x,
          y,
          size,
          strong,
        });
    }
  }
  return result;
}
async function assertFits(bytes: Uint8Array) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica),
    bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const item of drawn(bytes)) {
    assert.ok(item.x >= 35 && item.y >= 28 && item.y + item.size <= 764, `Out of page frame: ${JSON.stringify(item)}`);
    assert.ok(
      item.x + (item.strong ? bold : regular).widthOfTextAtSize(item.text, item.size) <= 577,
      `Outside right margin: ${item.text}`,
    );
    if (!item.text.startsWith('XBAR') && !/^\d+ \/ \d+$/.test(item.text))
      assert.ok(item.y >= 48, `Body entered footer: ${item.text}`);
  }
}

test('18-horse executive report has three deliberate pages, seven KPIs and complete registers', async () => {
  const report = buildRanchReport(fixture(), now);
  const bytes = await renderReportPdf(report, 'SYNTHETIC REVIEW FIXTURE - XBAR Ranch', await branding());
  assert.equal((await PDFDocument.load(bytes)).getPageCount(), 3);
  const text = drawn(bytes)
    .map((s) => s.text)
    .join(' ');
  for (const label of [
    'Executive dashboard',
    'Sale readiness & blockers',
    'Horse-level economics',
    'INVESTED',
    'LISTED VALUE',
    'POTENTIAL MARGIN',
    'MONTHLY BURN',
    'SALE-READY VALUE',
    'BLOCKED VALUE',
    'OPEN OFFERS',
    '100% OF ASKING VALUE BLOCKED',
    '$0 ready to close today',
    'prior 3 complete months',
    'not free care',
    'remaining 20 points',
    'not itemized',
    'unallocated overhead',
  ])
    assert.ok(text.includes(label), label);
  assert.equal(report.money.valueAtRisk, 252000);
  assert.equal(report.money.unallocatedThisMonth, 0);
  assert.equal(report.money.monthlyBurn, 0);
  assert.equal(report.documentsToReview, 0);
  assert.equal(reportDecisions(report).missingCoggins.length, 18);
  for (let i = 2; i <= 18; i++)
    assert.ok(text.includes(`Synthetic Ranch Horse ${i} / B`), `Missing economics horse ${i}`);
  assert.ok(!text.includes('unlocks'));
  await assertFits(bytes);
});

test('burn, overhead and profit exclude different periods and preserve sale inventory scope', () => {
  const input = fixture(2);
  input.horses[1].sale.askPrice = 0;
  input.horses[1].sale.listingState = 'Private';
  input.expenseReceipts.push({
    id: 'overhead',
    amount: 900,
    category: 'Feed',
    receiptDate: '2026-09-01',
  } as RanchReportInput['expenseReceipts'][number]);
  input.expenseReceipts.push({
    id: 'prior',
    horseId: 'h0',
    amount: 300,
    category: 'Feed',
    receiptDate: '2026-08-01',
  } as RanchReportInput['expenseReceipts'][number]);
  const report = buildRanchReport(input, now),
    decisions = reportDecisions(report);
  assert.equal(report.money.unallocatedThisMonth, 900);
  assert.equal(report.money.monthlyBurn, 100);
  assert.equal(report.money.investedThisMonth, 1147.9);
  assert.equal(decisions.potentialMargin, 9377);
  assert.equal(
    decisions.bands.reduce((n, b) => n + b.count, 0),
    1,
  );
  assert.ok(decisions.actions.some((s) => s.includes('$900')));
});

test('missing, review and transfer actions remain distinct; no duplicate unlock promises', () => {
  const report = buildRanchReport(fixture(1), now);
  const row = report.horses[0];
  row.blockers = ['Transfer pending - 2 documents unverified', 'Coggins on file has not been reviewed yet'];
  const e = reportException(row),
    d = reportDecisions(report);
  assert.equal(e.coggins, 'Review required');
  assert.match(e.ownership, /pending/);
  assert.equal(d.missingOwnership.length, 0);
  assert.equal(d.missingCoggins.length, 0);
  assert.ok(d.actions.some((a) => a.includes('Resolve transfer requirements for 1')));
  assert.ok(!d.actions.some((a) => a.includes('Obtain or record Coggins')));
});

test('empty workspace and large registers render with no lost rows or footer collisions', async () => {
  for (const count of [0, 75]) {
    const input = fixture(count);
    if (count) input.horses[0].name = 'Long registered horse name '.repeat(7);
    const bytes = await renderReportPdf(buildRanchReport(input, now), 'Owner ranch '.repeat(25), await branding());
    const texts = drawn(bytes)
      .map((s) => s.text)
      .join(' ');
    assert.ok(!/NaN|Infinity/.test(texts));
    for (let i = 2; i <= count; i++) assert.ok(texts.includes(`Synthetic Ranch Horse ${i} / B`), `Missing horse ${i}`);
    assert.ok((await PDFDocument.load(bytes)).getPageCount() >= 3);
    await assertFits(bytes);
  }
});

test('ready horses, losses and unpriced inventory produce honest labels and ranked opportunities', async () => {
  const input = fixture(3);
  input.horses[0].sale.askPrice = 1000;
  input.horses[1].sale.askPrice = 0;
  input.horses[1].status = 'Sale Prep';
  input.ownershipRecords = [
    { id: 'o2', horseId: 'h2', transferStatus: 'Clear', proofRequirements: [] },
  ] as unknown as RanchReportInput['ownershipRecords'];
  input.documents = [
    { id: 'c2', horseId: 'h2', type: 'Coggins', state: 'Ready', entities: { examDate: '2026-09-01' } },
  ] as unknown as RanchReportInput['documents'];
  const report = buildRanchReport(input, now),
    decisions = reportDecisions(report);
  assert.equal(report.money.readyValue, 14000);
  assert.equal(decisions.blocked.length, 2);
  assert.deepEqual(
    decisions.ranked.map((h) => h.horseId),
    ['h2', 'h0', 'h1'],
  );
  assert.equal(decisions.bands[2].count, 1);
  const bytes = await renderReportPdf(report, 'Mixed readiness fixture', await branding());
  const text = drawn(bytes)
    .map((s) => s.text)
    .join(' ');
  assert.ok(text.includes('Ready*'));
  assert.ok(text.includes('Current / reviewed'));
  assert.ok(text.includes('Review negative projected profits'));
  assert.ok(text.includes('N/A'));
  await assertFits(bytes);
});

// The export must work under a Pages base, and a first successful load must
// remain usable without a service worker on the next offline attempt.
test('report artwork honors the deployment base and survives offline after caching', async () => {
  const { reportBrandAssetPaths, loadReportBranding } = await import('../src/lib/reportBranding.js');
  assert.deepEqual(reportBrandAssetPaths('/XBAR/'), [
    '/XBAR/brand/xbar-report-horse.png',
    '/XBAR/brand/xbar-report-mark.png',
    '/XBAR/brand/xbar-report-watermark.png',
  ]);
  const originals = await branding();
  const values = [originals.logo, originals.mark, originals.watermark];
  const cacheValues = new Map<string, Response>();
  const cache = {
    match: async (key: RequestInfo | URL) => cacheValues.get(String(key))?.clone(),
    put: async (key: RequestInfo | URL, response: Response) => {
      cacheValues.set(String(key), response.clone());
    },
  } as Pick<Cache, 'match' | 'put'>;
  const paths: string[] = [];
  const online = (async (path: RequestInfo | URL) => {
    paths.push(String(path));
    return new Response(new Uint8Array(values[reportBrandAssetPaths('/XBAR/').indexOf(String(path))]));
  }) as typeof fetch;
  await loadReportBranding('/XBAR/', online, cache);
  assert.deepEqual(paths, reportBrandAssetPaths('/XBAR/'));
  const offline = (async () => {
    throw new Error('offline');
  }) as typeof fetch;
  const saved = await loadReportBranding('/XBAR/', offline, cache);
  assert.deepEqual(saved.logo, new Uint8Array(originals.logo));
  assert.deepEqual(saved.mark, new Uint8Array(originals.mark));
  await assert.rejects(loadReportBranding('/different/', offline, cache), /Reconnect/);
  // A successful HTML route fallback is not an image and must not poison cache.
  await loadReportBranding('/XBAR/', (async () => new Response('<html>not an image</html>')) as typeof fetch, cache);
  assert.deepEqual(
    new Uint8Array(await cacheValues.get(paths[0])!.clone().arrayBuffer()),
    new Uint8Array(originals.logo),
  );
});
