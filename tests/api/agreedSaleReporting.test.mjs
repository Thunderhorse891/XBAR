import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRanchFinancials } from '../../src/lib/profitIntelligence.ts';
import { buildRanchReport } from '../../src/lib/ranchReport.ts';
import { ranchReportToCsv } from '../../src/lib/ranchReportExport.ts';
import { buildSubscriptionForTier } from '../../src/lib/xbarRuntime.ts';
import { createEmptyWorkspaceState, createHorseRecord } from '../../src/store/xbarStoreHelpers.ts';
import { renderRoute, nodes } from '../helpers/recordWorkflowHarness.mjs';

const now = new Date('2026-10-11T12:00:00Z');

function fixture({ price = 25000, cost = 10000, overhead = 0, tier = 'Enterprise' } = {}) {
  const empty = createEmptyWorkspaceState();
  const created = createHorseRecord(
    {
      name: 'Synthetic Sale Horse',
      barnName: 'Agreement',
      sex: 'Mare',
      segment: 'Broodmare',
      status: 'Sale Prep',
      owner: 'Synthetic Ranch',
      ownerEntity: 'Synthetic Ranch',
      barn: 'A',
      pasture: 'A',
    },
    empty.workspaceProfile,
  );
  return {
    ...empty,
    subscription: buildSubscriptionForTier(empty.subscription, tier, { billingState: 'Active' }),
    horses: [{ ...created, id: 'horse', costBasis: cost, sale: { ...created.sale, askPrice: 50000 } }],
    salesLeads: [
      {
        id: 'unpaid-won',
        horseId: 'horse',
        name: 'Synthetic Buyer',
        channel: 'Referral',
        stage: 'Closed',
        outcome: 'Won',
        offerStatus: 'Draft',
        offerAmount: price,
        depositAmount: 5000,
        depositStatus: 'Due',
        lastTouch: '2026-05-01',
        offerUpdatedAt: '2026-05-01',
        savedListing: false,
        shareReady: false,
      },
    ],
    expenseReceipts: overhead
      ? [{ id: 'overhead', category: 'Other', amount: overhead, receiptDate: '2026-05-01' }]
      : [],
  };
}

// Evaluate the route's own small leaf components (such as its currency value),
// while the existing harness keeps app/UI/store boundaries controlled.
function visibleText(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(visibleText).join(' ');
  if (typeof node.type === 'function') return visibleText(node.type(node.props));
  if (!node.props) return '';
  return [node.props.title, node.props.subtitle, node.props.label, node.props.children]
    .map(visibleText)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const financials = (state) => buildRanchFinancials(state.horses, state.expenseReceipts, state.salesLeads, now);
const noCollectionClaim = (text) => assert.doesNotMatch(text, /banked|collected|cash in|proceeds.*came in/i);

for (const [label, input, expected] of [
  ['gain', {}, 15000],
  ['loss', { price: 5000 }, -5000],
  ['overhead-adjusted gain', { overhead: 300 }, 14700],
]) {
  test(`unpaid Won/Draft ${label} is presented as an estimated sale margin`, async () => {
    const state = fixture(input);
    const before = JSON.stringify(state);
    assert.equal(financials(state).netProfit, expected);
    const rendered = await renderRoute('Financials', state);
    const hero = nodes(rendered.tree, (node) => node.props.className === 'fin-stat fin-stat--hero')[0];
    assert.ok(hero);
    assert.match(visibleText(hero), /Estimated sale margin/);
    assert.ok(visibleText(hero).includes(`$${Math.abs(expected).toLocaleString('en-US')}`));
    assert.ok(visibleText(hero).includes(`$${(input.price ?? 25000).toLocaleString('en-US')}`));
    assert.match(visibleText(hero), /agreed/i);
    const text = visibleText(rendered.tree);
    assert.match(text, /Payment collection is not tracked/);
    assert.match(text, /agreed/i);
    noCollectionClaim(text);
    assert.equal(JSON.stringify(state), before, 'rendering cannot create payment evidence or change records');
  });
}

for (const [label, input, remediation] of [
  ['price', { price: 0 }, /record the sale amount|sale price/i],
  ['cost', { cost: 0 }, /add costs|cost.*missing/i],
  ['price and cost', { price: 0, cost: 0 }, /sale prices and costs/i],
]) {
  test(`missing ${label} leaves the displayed sale margin unknown`, async () => {
    const state = fixture(input);
    assert.equal(financials(state).netProfit, 0);
    const rendered = await renderRoute('Financials', state);
    const hero = nodes(rendered.tree, (node) => node.props.className === 'fin-stat fin-stat--hero')[0];
    const text = visibleText(hero);
    assert.match(text, /Estimated sale margin/);
    assert.match(text, /—/);
    assert.match(text, remediation);
    assert.match(visibleText(rendered.tree), /Payment collection is not tracked/);
    noCollectionClaim(visibleText(rendered.tree));
  });
}

test('locked Money view does not promise the recorded margin is banked profit', async () => {
  const rendered = await renderRoute('Financials', fixture({ tier: 'Starter' }));
  const text = visibleText(rendered.tree);
  assert.match(text, /Estimated sale margin/);
  assert.match(text, /Payment collection is not tracked/);
  noCollectionClaim(text);
});

for (const [label, input, insightId] of [
  ['gain', {}, 'win-horse'],
  ['loss', { price: 5000 }, 'loss-horse'],
  ['missing price', { price: 0 }, 'blindspot-sale-price'],
  ['missing cost', { cost: 0 }, 'blindspot-sold-cost'],
  ['overhead', { overhead: 20000 }, 'overhead-drag'],
]) {
  test(`${label} insight distinguishes the agreement from collection`, () => {
    const state = fixture(input);
    const insight = financials(state).insights.find((item) => item.id === insightId);
    assert.ok(insight, insightId);
    const text = `${insight.title} ${insight.detail}`;
    assert.match(insight.detail, /agreed|estimated/i);
    noCollectionClaim(text);
    if (label === 'overhead') {
      assert.match(text, /overhead/i);
      assert.doesNotMatch(text, /puts the operation.*in the red/i);
      assert.equal(insight.amount, -5000);
    }
  });
}

test('Reports and CSV preserve agreed values and never turn a due deposit into held cash', () => {
  const state = fixture();
  const report = buildRanchReport(state, now);
  assert.equal(report.horses[0].closedSaleValue, 25000);
  assert.equal(report.horses[0].closedSaleProfit, 15000);
  assert.equal(report.money.depositsHeld, 0);
  const csv = ranchReportToCsv(report, 'Synthetic Ranch');
  assert.match(csv, /Agreed closed sale value \(not cash received\)/);
  assert.match(csv, /Estimated closed sale margin \(before overhead\)/);
  assert.match(csv, /Payment collection is not tracked/);
  assert.match(csv, /"25000","15000"/);
  assert.doesNotMatch(csv, /Collected from sales|Profit banked|25000 collected/i);
});

test('two string-valued Won offers cannot concatenate into a multibillion-dollar margin', () => {
  const state = fixture({ price: '25000' });
  state.horses.push({ ...state.horses[0], id: 'second', name: 'Second Synthetic Horse' });
  state.salesLeads.push({ ...state.salesLeads[0], id: 'second-sale', horseId: 'second' });
  const fin = financials(state);
  assert.equal(fin.realizedProceeds, 0);
  assert.equal(fin.netProfit, 0);
  assert.equal(fin.soldMissingPriceCount, 2);
  assert.ok(fin.perAnimal.every((row) => row.saleValueUnknown));
  const csv = ranchReportToCsv(buildRanchReport(state, now), 'Synthetic Ranch');
  assert.equal((csv.match(/"sold","Unknown","Unknown"/g) ?? []).length, 2);
});

const invalidPrices = ['25000', 'not-a-price', NaN, Infinity, -100, {}, [], true, false, ''];
for (const value of invalidPrices) {
  test(`invalid selected counter ${String(value)} cannot fall back to a valid original offer`, () => {
    const state = fixture();
    state.salesLeads[0].counterOfferAmount = value;
    const fin = financials(state);
    assert.equal(fin.realizedProceeds, 0);
    assert.equal(fin.netProfit, 0);
    assert.equal(fin.soldMissingPriceCount, 1);
    assert.equal(fin.perAnimal[0].value, 0);
    assert.equal(fin.perAnimal[0].saleValueUnknown, true);
    assert.equal(buildRanchReport(state, now).horses[0].closedSaleValue, null);
  });
  test(`invalid selected pipeline price ${String(value)} cannot become the asking price`, () => {
    const state = fixture();
    Object.assign(state.salesLeads[0], {
      stage: 'Offer',
      outcome: undefined,
      offerStatus: 'Accepted',
      counterOfferAmount: value,
    });
    const fin = financials(state);
    assert.equal(fin.perAnimal[0].value, 0);
    assert.equal(fin.perAnimal[0].status, 'pipeline');
    assert.equal(fin.projectedProfit, 0);
    assert.equal(fin.unpricedPipelineCount, 1);
    const report = buildRanchReport(state, now);
    assert.equal(report.money.pipelineValue, 0);
    assert.equal(report.money.unpricedOfferCount, 1);
  });
  test(`invalid held asking price ${String(value)} does not invent projected profit`, () => {
    const state = fixture();
    state.salesLeads = [];
    state.horses[0].sale.askPrice = value;
    const fin = financials(state);
    assert.equal(fin.perAnimal[0].value, 0);
    assert.equal(fin.projectedProfit, 0);
    assert.equal(fin.unpricedHeldCount, 1);
    const report = buildRanchReport(state, now);
    assert.equal(report.money.listedValue, 0);
    assert.equal(report.money.unpricedListedCount, 1);
  });
}

function mixedPriceFixture() {
  const state = fixture();
  const horse = state.horses[0];
  const lead = { ...state.salesLeads[0], stage: 'Offer', outcome: undefined, offerStatus: 'Accepted' };
  state.horses = [
    { ...horse, id: 'valid-offer', name: 'Valid Offer Horse', sale: { ...horse.sale, askPrice: 30000 } },
    { ...horse, id: 'unknown-offer', name: 'Unknown Offer Horse', sale: { ...horse.sale, askPrice: 50000 } },
    { ...horse, id: 'valid-held', name: 'Valid Held Horse', costBasis: 4000, sale: { ...horse.sale, askPrice: 12000 } },
    { ...horse, id: 'unknown-held', name: 'Unknown Held Horse', sale: { ...horse.sale, askPrice: '70000' } },
  ];
  state.salesLeads = [
    { ...lead, id: 'valid-lead', horseId: 'valid-offer', offerAmount: 20000 },
    { ...lead, id: 'unknown-lead', horseId: 'unknown-offer', offerAmount: 25000, counterOfferAmount: '26000' },
  ];
  return state;
}

test('Money retains valid projected subtotals beside unknown offer and held prices', async () => {
  const state = mixedPriceFixture();
  const before = JSON.stringify(state);
  const fin = financials(state);
  assert.equal(fin.pipelineCount, 2);
  assert.equal(fin.heldCount, 2);
  assert.equal(fin.unpricedPipelineCount, 1);
  assert.equal(fin.unpricedHeldCount, 1);
  assert.equal(fin.projectedValue, 32000);
  assert.equal(fin.projectedProfit, 18000);
  const rendered = await renderRoute('Financials', state);
  const upside = nodes(
    rendered.tree,
    (node) => node.props.className === 'fin-stat' && visibleText(node).includes('Upside in the herd'),
  )[0];
  assert.ok(upside);
  const text = visibleText(upside);
  assert.match(text, /\$18,000/);
  assert.match(text, /\$32,000 projected value/);
  assert.match(text, /Partial: 2 prices unknown/);
  assert.equal(JSON.stringify(state), before, 'unknown price presentation never rewrites raw records');
});

test('Reports preserve known asking and offer subtotals and disclose their unknown counts in CSV', () => {
  const state = mixedPriceFixture();
  const before = JSON.stringify(state);
  const report = buildRanchReport(state, now);
  assert.equal(report.money.listedValue, 92000);
  assert.equal(report.money.unpricedListedCount, 1);
  assert.equal(report.money.pipelineValue, 20000);
  assert.equal(report.money.unpricedOfferCount, 1);
  const csv = ranchReportToCsv(report);
  assert.match(csv, /"Listed value","92000"/);
  assert.match(csv, /"Open offers","20000"/);
  assert.match(csv, /"Open offers with unknown prices \(excluded from subtotal\)","1"/);
  assert.match(csv, /"Listed horses with unknown prices \(excluded from value subtotals\)","1"/);
  assert.equal(JSON.stringify(state), before, 'reporting never coerces malformed stored prices into numbers');
});

for (const counterOfferAmount of [undefined, null, 0, 28000]) {
  test(`counter ${counterOfferAmount} preserves the established numeric selection contract`, () => {
    const state = fixture();
    state.salesLeads[0].counterOfferAmount = counterOfferAmount;
    const expected = counterOfferAmount || 25000;
    assert.equal(financials(state).realizedProceeds, expected);
    assert.equal(financials(state).netProfit, expected - 10000);
  });
}
