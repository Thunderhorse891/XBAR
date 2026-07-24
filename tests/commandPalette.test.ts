import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildCommandEntries,
  isPrivateIndexAllowed,
  scoreCommandEntry,
  searchCommandEntries,
  ROUTE_COMMANDS,
  type CommandEntry,
  type CommandSources,
} from '../src/lib/commandPalette.js';

// Minimal, realistic fixtures. Only the fields the index reads are populated;
// the source types are Pick<>-narrowed so this stays honest to the real shapes.
function makeSources(overrides: Partial<CommandSources> = {}): CommandSources {
  return {
    horses: [
      {
        id: 'h1',
        name: 'Warrior',
        segment: 'Performance',
        breed: 'Quarter Horse',
        registrationNumber: 'AQHA-55',
        owner: 'Dale Brisco',
        location: { barn: 'North Barn' },
      },
      {
        id: 'h2',
        name: 'Willow',
        segment: 'Broodmare',
        breed: 'Paint',
        registrationNumber: 'APHA-12',
        owner: 'Dale Brisco',
        location: { barn: 'South Barn' },
      },
    ],
    documents: [
      { id: 'd1', title: 'Coggins 2026', type: 'Coggins', state: 'Ready' },
      { id: 'd2', title: 'Warranty note', type: 'Note', state: 'Draft' },
    ],
    salesLeads: [{ id: 'l1', name: 'Rocking R Ranch', stage: 'Negotiating' }],
    expenseReceipts: [{ id: 'e1', title: 'Feed order', vendor: 'Purina', category: 'Feed', amount: 1250 }],
    ownershipRecords: [{ id: 'o1', legalOwner: 'Jess Nolan', horseId: 'h2' }],
    buyerPath: (leadId: string) => `/sales/buyers/${leadId}`,
    ...overrides,
  };
}

test('the index always includes the static navigation commands', () => {
  const entries = buildCommandEntries(makeSources());
  for (const route of ROUTE_COMMANDS) {
    assert.ok(
      entries.find((entry) => entry.id === route.id && entry.group === 'Navigate'),
      `missing nav command ${route.id}`,
    );
  }
});

test('horses, documents, buyers, and expenses are each indexed with real routes', () => {
  const entries = buildCommandEntries(makeSources());
  const byId = (id: string) => entries.find((entry) => entry.id === id);

  assert.equal(byId('horse-h1')?.path, '/horses/h1');
  assert.equal(byId('horse-h1')?.group, 'Horses');
  assert.equal(byId('document-d1')?.group, 'Documents');
  assert.equal(byId('lead-l1')?.path, '/sales/buyers/l1'); // uses the injected buyerPath
  assert.equal(byId('expense-e1')?.group, 'Expenses');
  assert.match(byId('expense-e1')?.detail ?? '', /\$1,250/); // deterministic currency formatting
});

test('people are derived and de-duplicated across horses and ownership records', () => {
  const entries = buildCommandEntries(makeSources());
  const people = entries.filter((entry) => entry.group === 'People');
  // Dale Brisco (owns 2 horses) + Jess Nolan (1 via ownership) = two distinct people.
  assert.equal(people.length, 2);

  const dale = people.find((entry) => entry.label === 'Dale Brisco');
  assert.ok(dale, 'Dale Brisco should be indexed once');
  assert.match(dale?.detail ?? '', /2 horses/); // counted distinct horses, not rows
  assert.equal(dale?.path, '/ownership');
});

test('an empty query opens to the navigation group only', () => {
  const groups = searchCommandEntries(buildCommandEntries(makeSources()), '   ');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].group, 'Navigate');
});

test('a label match beats a metadata-only match, and results are grouped', () => {
  const groups = searchCommandEntries(buildCommandEntries(makeSources()), 'war');
  const flat = groups.flatMap((group) => group.items);

  const warrior = flat.findIndex((entry) => entry.label === 'Warrior');
  const warranty = flat.findIndex((entry) => entry.label === 'Warranty note');
  assert.ok(warrior !== -1 && warranty !== -1, 'both "war" matches should appear');
  assert.ok(warrior < warranty, 'the label prefix match (Warrior) must rank above the weaker match');

  // Grouped output preserves the canonical group order (Horses before Documents).
  const groupOrder = groups.map((group) => group.group);
  assert.ok(groupOrder.indexOf('Horses') < groupOrder.indexOf('Documents'));
});

test('a horse is findable by its registration number (keyword match)', () => {
  const groups = searchCommandEntries(buildCommandEntries(makeSources()), 'aqha-55');
  const hit = groups.flatMap((group) => group.items).find((entry) => entry.id === 'horse-h1');
  assert.ok(hit, 'registration number in keywords should surface the horse');
});

test('scoring ranks exact < prefix < word-start < includes < metadata', () => {
  const entry: CommandEntry = {
    id: 'x',
    label: 'Silver Moon',
    detail: 'Broodmare',
    path: '/x',
    group: 'Horses',
    keywords: 'palomino',
  };
  assert.equal(scoreCommandEntry(entry, 'silver moon'), 0); // exact
  assert.equal(scoreCommandEntry(entry, 'silver'), 1); // prefix
  assert.equal(scoreCommandEntry(entry, 'moon'), 2); // word start
  assert.equal(scoreCommandEntry(entry, 'ilver'), 3); // substring
  assert.equal(scoreCommandEntry(entry, 'palomino'), 4); // metadata only
  assert.equal(Number.isFinite(scoreCommandEntry(entry, 'zebra')), false); // no match
});

test('a category-name query surfaces that category (group name is searchable)', () => {
  const entries = buildCommandEntries(makeSources());
  const buyers = searchCommandEntries(entries, 'buyers');
  assert.ok(
    buyers.some((group) => group.group === 'Buyers'),
    'typing "buyers" should surface buyer records',
  );
  const people = searchCommandEntries(entries, 'people');
  assert.ok(
    people.some((group) => group.group === 'People'),
    'typing "people" should surface people',
  );
});

test('distinct people never collide on id even with punctuation or non-ASCII names', () => {
  const entries = buildCommandEntries(
    makeSources({
      horses: [],
      ownershipRecords: [
        { id: 'a', legalOwner: 'Anne-Marie', horseId: 'h1' },
        { id: 'b', legalOwner: 'Anne Marie', horseId: 'h2' },
        { id: 'c', legalOwner: '张三', horseId: 'h3' },
        { id: 'd', legalOwner: '李四', horseId: 'h4' },
      ],
    }),
  );
  const people = entries.filter((entry) => entry.group === 'People');
  const ids = people.map((entry) => entry.id);
  assert.equal(ids.length, 4, 'four distinct owners');
  assert.equal(new Set(ids).size, 4, 'all four ids must be unique (usable as React keys)');
});

test('a receipt beyond the render cap is still indexed and findable', () => {
  const manyReceipts = Array.from({ length: 60 }, (_, index) => ({
    id: `e${index}`,
    title: index === 55 ? 'Unique Farrier Visit' : `Feed ${index}`,
    vendor: 'Vendor',
    category: 'Feed',
    amount: 100,
  }));
  const entries = buildCommandEntries(makeSources({ expenseReceipts: manyReceipts }));
  const hit = searchCommandEntries(entries, 'farrier visit')
    .flatMap((group) => group.items)
    .find((entry) => entry.id === 'expense-e55');
  assert.ok(hit, 'the 56th receipt must remain searchable by an exact title');
});

test('the private index is gated on entitlement (never leaks after sign-out)', () => {
  // Cloud build, signed out: no private data may be indexed.
  assert.equal(
    isPrivateIndexAllowed({ supabaseConfigured: true, hasLocalEntry: false, hasSession: false, status: 'signed-out' }),
    false,
  );
  // Cloud build, no session yet (loading): still suppressed.
  assert.equal(
    isPrivateIndexAllowed({ supabaseConfigured: true, hasLocalEntry: false, hasSession: false, status: 'loading' }),
    false,
  );
  // Cloud build, authenticated session: allowed.
  assert.equal(
    isPrivateIndexAllowed({ supabaseConfigured: true, hasLocalEntry: false, hasSession: true, status: 'ready' }),
    true,
  );
  // Local build (no Supabase): full access.
  assert.equal(
    isPrivateIndexAllowed({
      supabaseConfigured: false,
      hasLocalEntry: false,
      hasSession: false,
      status: 'unavailable',
    }),
    true,
  );
  // Local single-user entry grants access even when cloud is configured.
  assert.equal(
    isPrivateIndexAllowed({ supabaseConfigured: true, hasLocalEntry: true, hasSession: false, status: 'signed-out' }),
    true,
  );
});

test('per-group result caps are honored', () => {
  const manyHorses = Array.from({ length: 20 }, (_, index) => ({
    id: `h${index}`,
    name: `Ranger ${index}`,
    segment: 'Performance',
    breed: 'Quarter Horse',
    registrationNumber: `R-${index}`,
    owner: 'Solo Owner',
    location: { barn: 'Barn' },
  }));

  const groups = searchCommandEntries(buildCommandEntries(makeSources({ horses: manyHorses })), 'ranger', {
    limitPerGroup: 5,
  });
  const horseGroup = groups.find((group) => group.group === 'Horses');
  assert.equal(horseGroup?.items.length, 5);
});
