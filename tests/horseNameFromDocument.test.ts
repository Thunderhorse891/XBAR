import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { horseNameFromDocumentTitle, resolveHorseNameForProfile } from '../src/lib/horseNameFromDocument.js';

/*
 * The defect these cover shipped and was found by uploading twenty real papers:
 * every profile came out named by its registration number -- 35012691962,
 * 539882319930, 52793571973, 14325211973 -- because profile creation fell back
 * to the registration number when the OCR text carried no labelled name.
 *
 * Nothing failed. Twenty horses were created, each one named by a number, and
 * the only way to notice was to look at the roster.
 */

const titles: [string, string | undefined][] = [
  // The four filenames that produced the number-named horses.
  ['Bar B Joseywood pedigree', 'Bar B Joseywood'],
  ['Berry Peachy Chic - Copy - Copy', 'Berry Peachy Chic'],
  ['blue valentine dot com - Copy - Copy', 'blue valentine dot com'],
  ['Bonny lil Man Rogers - Copy - Copy', 'Bonny lil Man Rogers'],

  // Clutter from the ways scans actually reach a ranch folder.
  ['Smart Little Pepto registration papers.pdf', 'Smart Little Pepto'],
  ['registration - Docs Blue Valentine', 'Docs Blue Valentine'],
  ['Miss Kitty Jr_coggins_2026.pdf', 'Miss Kitty Jr'],
  // A year on its own end comes off, which exposes the paper word behind it.
  ['Frenchmans Guy registration 2024', 'Frenchmans Guy'],
  ['SHINING SPARK (1).jpg', 'SHINING SPARK'],
  ['Peppy San Badger - Copy (2).png', 'Peppy San Badger'],
  ['scanned document Frenchmans Guy front', 'Frenchmans Guy'],

  // A name whose own words collide with the paper vocabulary keeps them: only
  // the ends are stripped, and only while something is left.
  ['Docs Sale Bound pedigree', 'Docs Sale Bound'],

  // Nothing worth using. Each of these must refuse rather than invent.
  ['scan-001', undefined],
  ['IMG_4821', undefined],
  ['DSC 0001', undefined],
  ['20260916_113244', undefined],
  ['Untitled 3', undefined],
  ['35012691962', undefined],
  ['539882319930 - Copy', undefined],
  ['pedigree', undefined],
  ['registration papers', undefined],
  ['', undefined],
];

for (const [title, expected] of titles) {
  test(`horseNameFromDocumentTitle(${JSON.stringify(title)}) -> ${JSON.stringify(expected)}`, () => {
    assert.equal(horseNameFromDocumentTitle(title), expected);
  });
}

test('a registration number is never returned as a name', () => {
  // The specific shape of the bug: digit strings of the length real AQHA and
  // APHA numbers take, with and without the copy suffix.
  for (const number of ['35012691962', '539882319930', '52793571973', '14325211973', '5551234', '0456789']) {
    assert.equal(horseNameFromDocumentTitle(number), undefined, `${number} must not read as a name`);
    assert.equal(horseNameFromDocumentTitle(`${number} - Copy`), undefined);
    assert.equal(horseNameFromDocumentTitle(`${number}.pdf`), undefined);
  }
});

test('a paper with a number but no readable name is named from its title', () => {
  const name = resolveHorseNameForProfile({
    extractedName: '',
    documentTitles: ['Bar B Joseywood pedigree'],
  });

  assert.equal(name, 'Bar B Joseywood');
  assert.notEqual(name, '35012691962');
});

test('a labelled name in the paper still wins over the filename', () => {
  assert.equal(
    resolveHorseNameForProfile({ extractedName: 'Smart Little Pepto', documentTitles: ['scan-001'] }),
    'Smart Little Pepto',
  );
});

test('the first usable title wins when several papers are grouped', () => {
  assert.equal(
    resolveHorseNameForProfile({ documentTitles: ['IMG_4821', 'Berry Peachy Chic - Copy', 'scan-002'] }),
    'Berry Peachy Chic',
  );
});

test('no readable name anywhere resolves to nothing at all', () => {
  /*
   * Undefined is the instruction to create NO profile; the document stays in
   * review for manual assignment. This is the branch that used to hand back a
   * registration number.
   */
  assert.equal(resolveHorseNameForProfile({ extractedName: '', documentTitles: ['scan-001'] }), undefined);
  assert.equal(resolveHorseNameForProfile({ documentTitles: [] }), undefined);
  assert.equal(resolveHorseNameForProfile({ documentTitles: ['35012691962'] }), undefined);
});

test('profile creation names a horse only from this resolver, never a number', async () => {
  /*
   * The call site cannot be imported here -- it reaches the rest of the store
   * through Vite's `@/` alias, which the node test runner does not resolve.
   * That is precisely how the original defect stayed invisible, so the wiring
   * is pinned to the source instead.
   */
  const source = await readFile('src/store/xbarStoreHelpers.ts', 'utf8');
  const builder = source.slice(
    source.indexOf('export function buildHorseInputFromDocuments'),
    source.indexOf('export function createHorseFromDocuments'),
  );
  assert.ok(builder.length > 0, 'precondition: the builder was found');

  assert.match(
    builder,
    /const resolvedName = resolveHorseNameForProfile\(\{/,
    'the name must come from the resolver, which refuses to invent one',
  );
  assert.match(builder, /if \(!resolvedName\) \{\s*return null;/, 'an unnamed horse must not be created');
  assert.match(builder, /const normalizedHorseName = resolvedName\.trim\(\)\.toUpperCase\(\);/);
  assert.ok(
    !/\(horseName \|\| registrationNumber\)/.test(builder),
    'a registration number in the name field is the defect this replaced',
  );
  // The number still belongs in its own field.
  assert.match(builder, /registrationNumber,/, 'the registration number keeps its own field');
});
