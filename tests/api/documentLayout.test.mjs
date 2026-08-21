import assert from 'node:assert/strict';
import test from 'node:test';

import { asField, fieldsInLine } from '../../api/_lib/pdf.js';

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
