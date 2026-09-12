import assert from 'node:assert/strict';
import test from 'node:test';
import { describeDocumentCoverage, fullCoverage, imageRead } from '../src/lib/documentIntelligence.js';

test('a document read end to end says nothing', () => {
  assert.equal(describeDocumentCoverage(fullCoverage()), '');
  assert.equal(
    describeDocumentCoverage({ totalPages: 3, pagesRead: 1, pagesOcrRead: 2, truncated: false, readFailed: false }),
    '',
    'every page accounted for, by either route, is a complete read',
  );
});

test('a scan read only as far as the page budget says how far it got', () => {
  const message = describeDocumentCoverage({
    totalPages: 40,
    pagesRead: 0,
    pagesOcrRead: 3,
    truncated: false,
    readFailed: false,
  });
  assert.match(message, /Only 3 of 40 pages were read\./);
  assert.match(
    message,
    /missing, not absent/,
    'the customer has to know the gap is unexamined rather than empty, or a sale packet gets built on it',
  );
});

test('text cut at the character limit is disclosed on its own', () => {
  const message = describeDocumentCoverage({
    totalPages: 0,
    pagesRead: 0,
    pagesOcrRead: 0,
    truncated: true,
    readFailed: false,
  });
  assert.match(message, /cut short/);
});

test('both limits at once are reported together', () => {
  const message = describeDocumentCoverage({
    totalPages: 12,
    pagesRead: 2,
    pagesOcrRead: 1,
    truncated: true,
    readFailed: false,
  });
  assert.match(message, /Only 3 of 12 pages were read\./);
  assert.match(message, /cut short/);
});

test('a file whose page count is unknown does not invent one', () => {
  assert.equal(
    describeDocumentCoverage({ totalPages: 0, pagesRead: 0, pagesOcrRead: 1, truncated: false, readFailed: false }),
    '',
    'an image has no page count to compare against, so there is nothing honest to claim',
  );
});

test('a PDF where nothing could be read says so', () => {
  /*
   * This REPLACES a case that pinned the opposite, on the reasoning that "zero
   * of nine is a failed read, not a partial one; the empty extraction is the
   * honest signal". That was wrong. The empty extraction is not a signal the
   * customer ever sees -- what they see is the `processingNote`, and without one
   * a file that was read in full and a file that could not be read at all are
   * indistinguishable. A test can pin a defect as firmly as it pins a fix.
   *
   * The worst case, and it used to be silent. The partial-read guard required
   * `examined > 0`, so when every page failed to render or OCR returned nothing
   * for all of them, both counters stayed 0, no sentence was produced, and the
   * record carried no note -- a document read in full and a document not read
   * at all looked identical to the customer. That is precisely the dishonesty
   * this reporting exists to prevent.
   */
  const note = describeDocumentCoverage({
    totalPages: 6,
    pagesRead: 0,
    pagesOcrRead: 0,
    truncated: false,
    readFailed: false,
  });
  assert.match(note, /None of the 6 pages could be read\./);
  assert.match(note, /missing, not absent/);
});

test('a total failure that was also truncated reports both', () => {
  const note = describeDocumentCoverage({
    totalPages: 4,
    pagesRead: 0,
    pagesOcrRead: 0,
    truncated: true,
    readFailed: false,
  });
  assert.match(note, /None of the 4 pages could be read\./);
  assert.match(note, /cut short/);
});

test('a file with no page count is not described as unread', () => {
  /*
   * Images and plain text report `totalPages: 0` by design -- unknown, not
   * zero-of-zero. Announcing "none of the 0 pages could be read" for an image
   * that OCR handled perfectly would be a new false alarm in place of the old
   * false silence.
   */
  assert.equal(
    describeDocumentCoverage({ totalPages: 0, pagesRead: 0, pagesOcrRead: 0, truncated: false, readFailed: false }),
    '',
  );
});

test('an image whose OCR failed says so', () => {
  /*
   * The mirror of the PDF case, in the path the PDF fix deliberately left
   * alone. An image has no page count, so `totalPages` is 0 and the zero-of-N
   * sentence never applies to it -- which meant a photograph OCR could not read
   * and a photograph with no writing on it both arrived as `text: ''` with full
   * coverage, and the customer was told nothing either way. A worker whose
   * staged runtime assets are blocked fails exactly this way, for every image.
   */
  const note = describeDocumentCoverage({
    totalPages: 0,
    pagesRead: 0,
    pagesOcrRead: 0,
    truncated: false,
    readFailed: true,
  });
  assert.match(note, /This file could not be read\./);
  assert.match(note, /missing, not absent/);
});

test('an image that simply had no text is still not called a failure', () => {
  // The distinction the flag exists to draw: OCR ran and found nothing, which
  // is an honest empty result and must not be reported as a failed read.
  assert.equal(
    describeDocumentCoverage({ totalPages: 0, pagesRead: 0, pagesOcrRead: 0, truncated: false, readFailed: false }),
    '',
  );
});

test('a failed image OCR is carried into the coverage, an empty one is not', () => {
  /*
   * Covers the wiring, not just the sentence. This mapping used to live inline
   * at the call site, where a mutant that set `readFailed: !text` -- calling
   * every blank image a failure -- passed the whole suite, because
   * `readDocumentWithCoverage` needs a real tesseract worker and that throws
   * asynchronously in node and takes the process down.
   */
  assert.equal(imageRead({ text: '', failed: true }).coverage.readFailed, true);
  assert.equal(imageRead({ text: '', failed: false }).coverage.readFailed, false, 'no text is not a failure');
  assert.equal(imageRead({ text: 'REGISTERED NAME', failed: false }).coverage.readFailed, false);
  assert.equal(imageRead({ text: 'REGISTERED NAME', failed: false }).text, 'REGISTERED NAME');
});

/*
 * NOT covered here, and stated rather than implied: `runImageOcr`'s own catch
 * clause -- the line that turns a thrown worker into `failed: true`. Driving it
 * needs a tesseract worker that fails, and tesseract throws asynchronously
 * through `process.nextTick`, which escapes the try/catch and takes the node
 * process down rather than returning. A mutant flipping that clause to
 * `failed: false` therefore survives this suite.
 *
 * Everything the clause feeds IS covered: the mapping from its result to the
 * coverage (above) and from the coverage to what the customer reads (the note
 * cases). Closing the last line would mean injecting the worker factory, which
 * is worth doing if this area gains more logic; today it would add indirection
 * around three lines that cannot branch.
 */
