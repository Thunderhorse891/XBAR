import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countPagesRead,
  describeDocumentCoverage,
  fullCoverage,
  readOutcome,
  readableProcessingNote,
  readDocumentWithCoverage,
} from '../src/lib/documentIntelligence.js';

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
  assert.equal(readOutcome({ text: '', failed: true }).coverage.readFailed, true);
  assert.equal(readOutcome({ text: '', failed: false }).coverage.readFailed, false, 'no text is not a failure');
  assert.equal(readOutcome({ text: 'REGISTERED NAME', failed: false }).coverage.readFailed, false);
  assert.equal(readOutcome({ text: 'REGISTERED NAME', failed: false }).text, 'REGISTERED NAME');
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

test('a page whose text layer was judged unusable is not counted as read', () => {
  /*
   * The extractor classifies a page below MIN_TEXT_LAYER_CHARS as unusable --
   * that classification is the whole reason it attempts OCR on it. When OCR
   * then fails or returns nothing, the thin layer stays in `pageTexts`, and it
   * used to be counted as a page read purely because it was non-empty.
   *
   * A scan whose every page carries the same boilerplate header therefore
   * reported FULL coverage while the extractor had judged not one page
   * readable, so `describeDocumentCoverage` said nothing.
   */
  const pageTexts = ['REGISTRY COPY', 'REGISTRY COPY', 'REGISTRY COPY'];
  const unusable = new Set([1, 2, 3]);
  assert.equal(countPagesRead(pageTexts, unusable, new Set()), 0);

  // And the customer is now told, rather than shown full coverage.
  const note = describeDocumentCoverage({
    totalPages: 3,
    pagesRead: countPagesRead(pageTexts, unusable, new Set()),
    pagesOcrRead: 0,
    truncated: false,
    readFailed: false,
  });
  assert.match(note, /None of the 3 pages could be read\./);
});

test('a page OCR rescued is counted once, as an OCR page', () => {
  // Otherwise the same page is counted twice and coverage overstates itself.
  const pageTexts = ['REGISTRY COPY', 'BAY MARE FOALED 2019 SIRE ...'];
  assert.equal(countPagesRead(pageTexts, new Set([1, 2]), new Set([2])), 0);

  /*
   * And pinned independently of the unusable set, because today's caller only
   * ever OCRs pages it has already classified unusable -- so the OCR check is
   * redundant THERE and a mutant removing it survived the case above. This
   * function is exported and its own contract is the thing under test: a page
   * counted as an OCR page is never also counted as a text page, whatever the
   * caller happens to pass.
   */
  assert.equal(countPagesRead(['a full page of usable registration text'], new Set(), new Set([1])), 0);
});

test('a page with a usable text layer of its own is counted', () => {
  const pageTexts = ['a full page of registration text well past the threshold', ''];
  assert.equal(countPagesRead(pageTexts, new Set([2]), new Set()), 1);
});

test('a blank page with a usable-length classification still contributes nothing', () => {
  // Emptiness is checked as well as classification: a page that yielded no text
  // was examined but contributes no facts.
  assert.equal(countPagesRead(['', ''], new Set(), new Set()), 0);
});

test('a restored note that is not a string never reaches the screen', () => {
  /*
   * `processingNote` is written by this module, so a freshly read document
   * always carries a string. It also arrives from imports and cloud restores,
   * and the persisted-state validator's document entry does not list this new
   * field, so a damaged or hand-edited backup carries `{}` or a number straight
   * through. React then throws "Objects are not valid as a React child" and
   * takes the Documents page down: a defect in a backup becomes a broken app.
   */
  assert.equal(readableProcessingNote({}), '');
  assert.equal(readableProcessingNote(42), '');
  assert.equal(readableProcessingNote(null), '');
  assert.equal(readableProcessingNote(undefined), '');
  assert.equal(readableProcessingNote(['Only 1 of 9 pages were read.']), '');
  // And a real note is passed through untouched.
  assert.equal(readableProcessingNote('Only 1 of 9 pages were read.'), 'Only 1 of 9 pages were read.');
});

test('a PDF that never opened is reported as unreadable', () => {
  /*
   * `getDocument`, worker initialisation and text extraction all throw for a
   * malformed or password-protected file, and the top-level catch returned
   * `fullCoverage()`. The page counters cannot express that failure: totalPages
   * is 0 because the document never opened, so the zero-of-N sentence had no N
   * and the record looked exactly like a file examined in full.
   *
   * Same shape as the image path -- a catch returning an empty result is
   * indistinguishable from an empty file unless it says which it was.
   */
  const note = describeDocumentCoverage({
    totalPages: 0,
    pagesRead: 0,
    pagesOcrRead: 0,
    truncated: false,
    readFailed: true,
  });
  assert.match(note, /This file could not be read\./);
  assert.doesNotMatch(note, /0 pages/, 'a file that never opened has no page count to claim');
});

test('a broken PDF really does come back marked unreadable, end to end', async () => {
  /*
   * Not just the sentence: the catch itself. This one IS drivable in node --
   * pdfjs rejects "Invalid PDF structure." from `getDocument` and the handler
   * returns rather than throwing past it -- unlike the image path, where
   * tesseract fails asynchronously through process.nextTick and takes the
   * process down, which is why that clause is documented as uncovered.
   *
   * Worth the round trip: a `readFailed` that is set in a catch nobody exercises
   * is exactly the shape of wiring that has passed review while doing nothing.
   */
  const noise = console.error;
  console.error = () => {};
  try {
    const broken = new File(
      [new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0xff, 0xff])],
      'broken.pdf',
      {
        type: 'application/pdf',
      },
    );
    const result = await readDocumentWithCoverage(broken);
    assert.equal(result.text, '');
    assert.equal(result.coverage.readFailed, true, 'the customer must be told the file could not be read');
    assert.match(describeDocumentCoverage(result.coverage), /This file could not be read\./);
  } finally {
    console.error = noise;
  }
});

test('a text file whose read was rejected is reported, not silently empty', async () => {
  /*
   * `file.text()` rejects when the selected local file has become unreadable --
   * moved, unmounted, permission withdrawn between picking it and reading it.
   * That used to become `''`, which is also what an empty file produces.
   *
   * This is the THIRD finding of the same shape (PDF, image, then text), which
   * is why the shape was removed rather than patched again: every reader now
   * returns `{ text, failed }` and `readOutcome()` is the only thing that turns
   * that into coverage, so a new reader cannot report silence as success.
   */
  const unreadable = new File([''], 'notes.txt', { type: 'text/plain' });
  Object.defineProperty(unreadable, 'text', {
    value: () => Promise.reject(new DOMException('NotReadableError', 'NotReadableError')),
  });
  const result = await readDocumentWithCoverage(unreadable);
  assert.equal(result.coverage.readFailed, true);
  assert.match(describeDocumentCoverage(result.coverage), /This file could not be read\./);
});

test('a text file that is genuinely empty is not called a failure', async () => {
  // The distinction the flag exists to draw, at the other end.
  const empty = new File([''], 'notes.txt', { type: 'text/plain' });
  const result = await readDocumentWithCoverage(empty);
  assert.equal(result.coverage.readFailed, false);
  assert.equal(describeDocumentCoverage(result.coverage), '');
});

test('a file type this reader has no opinion about is not called a failure', async () => {
  // Nothing was attempted, so nothing failed; silence there is honest.
  const other = new File([new Uint8Array([1, 2, 3])], 'scan.dwg', { type: 'application/acad' });
  const result = await readDocumentWithCoverage(other);
  assert.equal(result.coverage.readFailed, false);
});
