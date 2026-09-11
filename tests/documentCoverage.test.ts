import assert from 'node:assert/strict';
import test from 'node:test';
import { describeDocumentCoverage, fullCoverage } from '../src/lib/documentIntelligence.js';

test('a document read end to end says nothing', () => {
  assert.equal(describeDocumentCoverage(fullCoverage()), '');
  assert.equal(
    describeDocumentCoverage({ totalPages: 3, pagesRead: 1, pagesOcrRead: 2, truncated: false }),
    '',
    'every page accounted for, by either route, is a complete read',
  );
});

test('a scan read only as far as the page budget says how far it got', () => {
  const message = describeDocumentCoverage({ totalPages: 40, pagesRead: 0, pagesOcrRead: 3, truncated: false });
  assert.match(message, /Only 3 of 40 pages were read\./);
  assert.match(
    message,
    /missing, not absent/,
    'the customer has to know the gap is unexamined rather than empty, or a sale packet gets built on it',
  );
});

test('text cut at the character limit is disclosed on its own', () => {
  const message = describeDocumentCoverage({ totalPages: 0, pagesRead: 0, pagesOcrRead: 0, truncated: true });
  assert.match(message, /cut short/);
});

test('both limits at once are reported together', () => {
  const message = describeDocumentCoverage({ totalPages: 12, pagesRead: 2, pagesOcrRead: 1, truncated: true });
  assert.match(message, /Only 3 of 12 pages were read\./);
  assert.match(message, /cut short/);
});

test('a file whose page count is unknown does not invent one', () => {
  assert.equal(
    describeDocumentCoverage({ totalPages: 0, pagesRead: 0, pagesOcrRead: 1, truncated: false }),
    '',
    'an image has no page count to compare against, so there is nothing honest to claim',
  );
});

test('a document nothing could be read from makes no page claim', () => {
  assert.equal(
    describeDocumentCoverage({ totalPages: 9, pagesRead: 0, pagesOcrRead: 0, truncated: false }),
    '',
    'zero of nine is a failed read, not a partial one; the empty extraction is the honest signal',
  );
});
