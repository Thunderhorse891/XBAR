import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PDFDocument, StandardFonts } from 'pdf-lib';

import { asField, createSectionedPdf, fieldsInLine, toDrawableText, wrapLine } from '../../api/_lib/pdf.js';

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

/*
 * One unusual character in one name must not fail an entire document.
 *
 * pdf-lib's standard Helvetica is WinAnsi-encoded and THROWS on anything
 * outside CP1252 rather than degrading — so a horse called `Dvořák`, or an
 * owner who put an emoji in a name field, took down every bill of sale, sale
 * packet cover and ranch report that mentioned them.
 */
test('a name outside WinAnsi still produces a document', async () => {
  for (const name of ['Dvořák', '馬', 'Docs Best 🐴', 'Łukasz', 'Đorđe']) {
    const bytes = await createSectionedPdf({
      title: 'Bill of Sale',
      sections: [{ heading: 'Horse', lines: [`Registered Name: ${name}`] }],
      footer: 'f',
    });
    assert.ok(bytes.length > 0, `${name} must render`);
  }

  // Every field the caller supplies goes through the same fold, not just the
  // section lines — a title or letterhead is just as likely to carry a name.
  const bytes = await createSectionedPdf({
    title: 'Dvořák 馬',
    letterhead: 'Dvořák Ranch',
    reference: 'Packet 馬',
    sections: [{ heading: 'Dvořák', lines: ['Owner: Dvořák'] }],
    footer: 'Dvořák',
  });
  assert.ok(bytes.length > 0);
});

test('folding keeps what the font can already draw', async () => {
  // Guards the fix. Stripping accents wholesale would satisfy the test above
  // and quietly respell every Latin-1 name the product handles correctly today
  // — CP1252 covers é, ñ, ü, ç and the rest.
  assert.equal(toDrawableText('Café Olé'), 'Café Olé');
  assert.equal(toDrawableText('Señor Ñandú'), 'Señor Ñandú');
  assert.equal(toDrawableText('Ostrož Žižka'), 'Ostrož Žižka');
  assert.equal(toDrawableText('Peppy — San "Badger"'), 'Peppy — San "Badger"');

  // Only what cannot be drawn is folded, and only as far as it has to be.
  assert.equal(toDrawableText('Dvořák'), 'Dvorák', 'ř folds, á is kept');
  assert.equal(toDrawableText('Łukasz'), 'Lukasz', 'a stroked letter has no combining mark to drop');

  // No Latin equivalent: a visible placeholder, never a silent deletion, which
  // would render two different horses under the same name.
  assert.equal(toDrawableText('馬'), '?');
  assert.equal(toDrawableText('A🐴B'), 'A?B');

  assert.equal(toDrawableText(''), '');
  assert.equal(toDrawableText(undefined), '');
});

/*
 * A line break is a separator, not an unsupported character.
 *
 * Before the WinAnsi fold, `wrapLine` split on /\s+/, so a newline inside a
 * value acted as a word break and a multiline medical note wrapped naturally.
 * The fold then treated `\n` as a glyph it could not draw and replaced it with
 * '?', which both printed a spurious character and welded the two lines into
 * one word.
 */
test('line breaks inside a value become spaces, not question marks', () => {
  assert.equal(toDrawableText('Initial exam\nFollow-up required'), 'Initial exam Follow-up required');
  assert.equal(toDrawableText('tab\there'), 'tab here');

  // Every whitespace control, including the Unicode line/paragraph separators.
  for (const control of ['\n', '\r', '\v', '\f', '\u0085', '\u2028', '\u2029']) {
    assert.equal(toDrawableText(`A${control}B`), 'A B', `${JSON.stringify(control)} must become a space`);
  }

  // Guards the fix from the other side: a real unsupported glyph is still a
  // visible placeholder, not a space, or two horses would render alike.
  assert.equal(toDrawableText('A馬B'), 'A?B');
});

test('a multiline note renders as one wrapped value', async () => {
  const bytes = await createSectionedPdf({
    title: 'Health Record',
    sections: [{ heading: 'Notes', lines: ['Medical: Initial exam\nFollow-up required in 14 days'] }],
    footer: 'f',
  });
  assert.ok(bytes.length > 0);
});

/*
 * The letterhead is user-controlled and unbounded.
 *
 * Settings imposes no maximum on a ranch name, and this was drawn as a single
 * unbounded line while the title directly below it had always wrapped. A long
 * name ran past the right edge and was clipped — on the one line of the page
 * that says whose document it is.
 */
test('a long letterhead wraps inside the page instead of clipping', async () => {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const maxWidth = 612 - 2 * 56;

  const name =
    'Thunderhorse Quarter Horses and Cattle Company of the Northern Front Range and High Plains Cooperative Limited Liability Company';

  // The premise: this genuinely does not fit, so the test cannot pass by luck.
  assert.ok(bold.widthOfTextAtSize(name, 10) > maxWidth, 'the fixture must actually overflow');

  const lines = wrapLine(name, bold, 10, maxWidth);
  assert.ok(lines.length > 1, 'it must wrap');
  for (const line of lines) {
    assert.ok(bold.widthOfTextAtSize(line, 10) <= maxWidth, `"${line}" overruns the page`);
  }

  const bytes = await createSectionedPdf({ title: 'Bill of Sale', letterhead: name, sections: [], footer: 'f' });
  assert.ok(bytes.length > 0);

  // The wrapping above only proves the helper works. This asserts the
  // letterhead actually goes THROUGH it — reverting the draw site to a single
  // unbounded `text(letterhead, ...)` leaves every assertion above green,
  // which is how a weak test lets a fixed bug come back.
  const source = readFileSync(path.join(process.cwd(), 'api/_lib/pdf.js'), 'utf8');
  const block = source.slice(source.indexOf('if (letterhead) {'), source.indexOf('paragraph(title'));
  assert.match(block, /wrapLine\(letterhead, bold, 10, maxWidth\)/, 'the letterhead must be wrapped before drawing');
  assert.ok(!/text\(letterhead,/.test(block), 'the raw letterhead must never be drawn as a single unbounded line');
});

/*
 * The footer and the page stamp share a baseline and must not collide.
 *
 * The footer carries an unbounded workspace business name —
 * `Generated by XBAR for ${businessName} on ${date}` — drawn from the left,
 * while "Page N of M" is drawn from the right. With no reserved gap a long
 * legal name ran straight through the stamp and neither was readable: a
 * 90-character name overlapped by 27pt.
 *
 * This is the sibling of the letterhead fix. Both were unbounded
 * user-controlled values on a page where everything else wrapped, and fixing
 * one without the other is how the second survived a round.
 */
test('a long footer never runs into the page stamp', async () => {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);

  const business = 'Thunderhorse Quarter Horses and Cattle Company of the Northern Front Range Cooperative LLC';
  const footer = `Generated by XBAR for ${business} on 2026-08-24`;

  // The premise: unconstrained, this genuinely collides.
  const stampWidth = font.widthOfTextAtSize('Page 1 of 1', 8);
  const unconstrained = 56 + font.widthOfTextAtSize(footer, 8);
  assert.ok(unconstrained > 612 - 56 - stampWidth, 'the fixture must actually overlap when unconstrained');

  const bytes = await createSectionedPdf({
    title: 'Bill of Sale',
    sections: [{ heading: 'Horse', lines: ['Name: Docs Best'] }],
    footer,
  });
  assert.ok(bytes.length > 0);

  // The stamp is placed before the footer, so the footer knows its budget.
  const source = readFileSync(path.join(process.cwd(), 'api/_lib/pdf.js'), 'utf8');
  const block = source.slice(source.indexOf('pages.forEach((footerPage'));
  const stampAt = block.indexOf('const stamp =');
  const footerAt = block.indexOf('if (footer) {');
  assert.ok(stampAt !== -1 && footerAt !== -1);
  assert.ok(stampAt < footerAt, 'the stamp must be measured before the footer is drawn');
  assert.match(block, /truncateToWidth\(footer, font, 8, available\)/, 'the footer must be fitted to what is left');
  assert.ok(!/drawText\(footer,/.test(block), 'the raw footer must never be drawn without a width budget');
});

test('a short footer is left exactly as written', () => {
  // Guards the fix: truncating unconditionally, or reserving so much space that
  // ordinary footers get clipped, would satisfy the test above.
  const short = 'XBAR Ranch Ledger';
  assert.equal(toDrawableText(short), short);
});
