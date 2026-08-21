import assert from 'node:assert/strict';
import test from 'node:test';

import { PDFDocument, StandardFonts } from 'pdf-lib';

import { asField, createSectionedPdf, fieldsInLine, wrapLine } from '../../api/_lib/pdf.js';

/*
 * How a template line becomes a row on the page.
 *
 * The documents were a flat dump of "Label: value" strings in running text.
 * These two functions are what turn them into aligned label/value rows and
 * ruled fill-in blanks, and they apply to nearly every line of all fifteen
 * templates — so a mistake here is a mistake in every document the product
 * sells.
 */

test('a simple field splits into label and value', () => {
  assert.deepEqual(asField('Purchase price: $18,500'), { label: 'Purchase price', value: '$18,500' });
});

test('several fields on one line are split apart', () => {
  // Templates write these with wide spacing:
  //   'Breed: {{...}}    Color: {{...}}    Sex: {{...}}'
  const fields = fieldsInLine('Breed: Quarter Horse    Color: Sorrel    Sex: Gelding');

  assert.equal(fields.length, 3);
  assert.deepEqual(
    fields.map((field) => field.label),
    ['Breed', 'Color', 'Sex'],
  );
  assert.equal(fields[2].value, 'Gelding');
});

test('a run of underscores is a blank to fill in, not a value', () => {
  // Both the signature lines and any placeholder the workspace has not filled
  // in arrive as underscores. Printing them would put a row of typed
  // underscores on a document someone signs.
  assert.equal(asField('Signature: ________________________________').value, '');
  assert.equal(asField('Agreement date: ____________').value, '');
});

test('a partly-known value keeps the part that is known', () => {
  // The regression this pins: 'Registration #: {{number}} ({{registry}})' with
  // no registry resolves to 'AQHA 5488210 (____________)'. Treating the whole
  // value as blank because it contains underscores dropped a real registration
  // number off a bill of sale.
  const field = asField('Registration #: AQHA 5488210 (____________)');

  assert.equal(field.label, 'Registration #');
  assert.equal(field.value, 'AQHA 5488210', 'the known registration number must survive');
});

test('prose is left alone', () => {
  const prose = 'The horse is sold as-is. Risk of loss passes to the buyer upon delivery.';
  assert.equal(fieldsInLine(prose), null);
  assert.equal(asField(prose), null);
});

test('a line that is part field and part prose stays prose', () => {
  // Splitting it would strand the sentence in a value column.
  assert.equal(fieldsInLine('Deposit: $3,000    The balance is due on delivery of the horse.'), null);
});

/*
 * Nothing may be drawn wider than the column it is drawn into.
 *
 * wrapLine only broke on whitespace, and had an escape that emitted a token
 * wider than the column whole rather than dropping it to the next line. The
 * sale-packet cover renders `Verify this packet: <origin>/app/verify/<packetId>`
 * through the value column, which is 332pt wide: with the deployed origin that
 * URL measures ~353pt and was drawn past the right margin, and a longer packet
 * id ran clean off the 612pt page — taking the verification link, the one thing
 * on that page a buyer has to be able to read, with it.
 */
const VALUE_COLUMN = 612 - 2 * 56 - 168;

async function helvetica() {
  const doc = await PDFDocument.create();
  return doc.embedFont(StandardFonts.Helvetica);
}

test('a URL too wide for its column is broken instead of overflowing', async () => {
  const font = await helvetica();
  const url = 'https://xbar-horse-management-app.vercel.app/app/verify/pk_1a2b3c4d5e6f';

  // The premise: this is genuinely wider than the column, so the test cannot
  // pass because the input happened to fit.
  assert.ok(
    font.widthOfTextAtSize(url, 10.5) > VALUE_COLUMN,
    'the fixture URL must actually overflow, or this proves nothing',
  );

  const lines = wrapLine(`Verify this packet: ${url}`, font, 10.5, VALUE_COLUMN);

  assert.ok(lines.length > 1, 'it must wrap');
  for (const line of lines) {
    assert.ok(
      font.widthOfTextAtSize(line, 10.5) <= VALUE_COLUMN,
      `"${line}" is ${font.widthOfTextAtSize(line, 10.5).toFixed(1)}pt in a ${VALUE_COLUMN}pt column`,
    );
  }

  // Broken, not truncated. A URL that renders inside the margin but has lost
  // characters is worse than one that overflows: it looks correct and is not.
  assert.equal(lines.join('').replace(/\s+/g, ''), `Verify this packet: ${url}`.replace(/\s+/g, ''));
});

test('a token with no separators at all is still broken to fit', async () => {
  const font = await helvetica();
  // No whitespace and nothing in TOKEN_BREAK_AFTER, so the character-level
  // fallback is the only thing that can wrap this.
  const blob = 'A'.repeat(300);
  const lines = wrapLine(blob, font, 10.5, VALUE_COLUMN);

  assert.ok(lines.length > 1);
  for (const line of lines) {
    assert.ok(font.widthOfTextAtSize(line, 10.5) <= VALUE_COLUMN);
  }
  assert.equal(lines.join(''), blob);
});

test('ordinary text is unaffected by the token-breaking fallback', async () => {
  const font = await helvetica();

  // Guards the fix: breaking everything by character would satisfy the tests
  // above and would ruin every other line in every document.
  assert.deepEqual(wrapLine('Purchase price: $18,500', font, 10.5, VALUE_COLUMN), ['Purchase price: $18,500']);
  assert.deepEqual(wrapLine('', font, 10.5, VALUE_COLUMN), ['']);

  // A paragraph still breaks between words, never inside one.
  const prose =
    'The seller warrants that the horse described above is free of any lien or encumbrance at the time of sale.';
  for (const line of wrapLine(prose, font, 10.5, VALUE_COLUMN)) {
    assert.ok(font.widthOfTextAtSize(line, 10.5) <= VALUE_COLUMN);
    for (const word of line.split(' ')) {
      assert.ok(prose.split(/\s+/).includes(word), `"${word}" was split mid-word`);
    }
  }
});

test('a long URL breaks after a separator where one is available', async () => {
  const font = await helvetica();
  const lines = wrapLine(
    'https://xbar-horse-management-app.vercel.app/app/verify/pk_1a2b3c4d5e6f',
    font,
    10.5,
    VALUE_COLUMN,
  );

  // Readability, not just fit: a reader retyping the address from paper needs
  // the break to fall somewhere they can see it.
  assert.ok(/[/?&=\-_.,;:#+~%]$/.test(lines[0]), `expected the first line to end at a separator, got "${lines[0]}"`);
});

/*
 * A page is added because there is something to put on it.
 *
 * Room was checked AFTER drawing each value line, so the last line of the last
 * field could start a page for a line that was never coming: a trailing sheet
 * carrying nothing but the footer and "Page 2 of 2". Verified against the
 * previous code, which produced exactly that at 34 one-line fields.
 */
test('a section that just fits does not add a page for nothing', async () => {
  // Swept across the boundary rather than pinned to one count, so a layout
  // change that moves the break is still covered.
  for (let count = 26; count <= 34; count += 1) {
    const lines = Array.from({ length: count }, (_, index) => `Field ${index + 1}: value ${index + 1}`);
    const bytes = await createSectionedPdf({ title: 'Boundary', sections: [{ heading: 'S', lines }], footer: 'f' });
    const pdf = await PDFDocument.load(bytes);
    assert.equal(pdf.getPageCount(), 1, `${count} one-line fields must fit on one page`);
  }
});

test('content that genuinely overflows still gets its second page', async () => {
  // Guards the fix: never adding a page would satisfy the test above and lose
  // every field past the first page.
  const lines = Array.from({ length: 60 }, (_, index) => `Field ${index + 1}: value ${index + 1}`);
  const bytes = await createSectionedPdf({ title: 'Overflow', sections: [{ heading: 'S', lines }], footer: 'f' });
  const pdf = await PDFDocument.load(bytes);
  assert.ok(pdf.getPageCount() >= 2, 'sixty fields do not fit on one page');
});
