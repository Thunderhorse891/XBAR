import assert from 'node:assert/strict';
import test from 'node:test';
import { csvField, csvRow } from '../src/lib/csv.js';

/*
 * The single copy of CSV field escaping every spreadsheet export uses.
 * costPerHorseExport.ts and ranchReportExport.ts once carried independent
 * copies of this formula-injection guard; a hardening change to one could
 * leave the other vulnerable. Both now import from here, and this test pins
 * the policy in one place.
 */
test('formula-leading cells are prefixed so spreadsheets read them as text', () => {
  for (const payload of ['=1+1', '+1+1', '-2+3', '@SUM(A1:A9)', '\t=1+1', '\n=1+1', '  =1+1']) {
    assert.ok(csvField(payload).startsWith(`"'${payload.replace(/"/g, '""')}`), `"${payload}" must be neutralized`);
  }
});

test('ordinary values are untouched', () => {
  assert.equal(csvField('Docs Best'), '"Docs Best"');
  assert.equal(csvField(' Sunny'), '" Sunny"');
  // Numbers stay numbers — never text-prefixed, so sums keep working.
  assert.equal(csvField(-500), '"-500"');
  assert.ok(!csvField(-500).includes("'"), 'a negative number is not formula-guarded');
});

test('commas and quotes round-trip inside quoted fields', () => {
  assert.equal(csvField('Docs Best, Jr.'), '"Docs Best, Jr."');
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
});

test('csvRow joins escaped fields', () => {
  assert.equal(csvRow(['a', 'b,c', 3]), '"a","b,c","3"');
});
