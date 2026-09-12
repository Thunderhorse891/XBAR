const TEXT_PREVIEW_LIMIT = 12000;
const PDF_TEXT_PAGE_LIMIT = 8;
const PDF_OCR_PAGE_LIMIT = 3;
// Scanned registration papers often carry a token text layer (a title or form
// labels) while the real horse data lives in the page image. Below this many
// characters we treat the text layer as unusable and fall through to OCR.
const MIN_TEXT_LAYER_CHARS = 60;

/**
 * What was actually examined, so a partial read can say so.
 *
 * Every limit above is applied by truncation -- 8 text pages, 3 OCR pages,
 * 12,000 characters -- and the extractor used to return a bare string, so a
 * 40-page scan was read to page 3 and nothing told the customer. A document
 * that says nothing about what it skipped invites someone to trust a sale
 * packet built from a third of a file.
 */
export type DocumentCoverage = {
  /** Pages the file has, when knowable. 0 for images and plain text. */
  totalPages: number;
  /** Pages whose own text layer was used. */
  pagesRead: number;
  /** Pages read by OCR because they carried no usable text layer. */
  pagesOcrRead: number;
  /** The text was cut at the character limit. */
  truncated: boolean;
  /**
   * The reader could not examine the file at all -- OCR threw rather than
   * returning nothing.
   *
   * Needed because emptiness is ambiguous and the page counters cannot say so
   * for an image: an image has no page count, so `totalPages` is 0 and the
   * zero-of-N sentence never applies. A photograph OCR failed on and a
   * photograph with no writing in it both arrived as `text: ''` with full
   * coverage, and the customer was told nothing either way.
   */
  readFailed: boolean;
};

export const fullCoverage = (): DocumentCoverage => ({
  totalPages: 0,
  pagesRead: 0,
  pagesOcrRead: 0,
  truncated: false,
  readFailed: false,
});

/**
 * How many pages contributed text of their OWN that the reader trusted.
 *
 * Pure, because the call site cannot be tested: it needs a real pdfjs document.
 *
 * A page whose text layer fell below `MIN_TEXT_LAYER_CHARS` was explicitly
 * CLASSIFIED as unusable -- that classification is the reason OCR was attempted
 * on it. If OCR then failed or returned nothing, the thin layer stays in
 * `pageTexts` and used to be counted as a page read, purely because it was
 * non-empty. A scan whose every page carries the same boilerplate header
 * therefore reported full coverage while the extractor had judged that not one
 * page was readable, and the customer was told nothing at all.
 *
 * So a page counts here only if its own text layer was usable. Pages OCR
 * rescued are counted separately, as `pagesOcrRead`; pages that were neither
 * are counted by nobody, which is the point.
 */
export function countPagesRead(
  pageTexts: readonly string[],
  unusableTextLayers: ReadonlySet<number>,
  ocrPages: ReadonlySet<number>,
): number {
  return pageTexts.filter((pageText, index) => {
    const pageNumber = index + 1;
    if (ocrPages.has(pageNumber)) return false;
    if (unusableTextLayers.has(pageNumber)) return false;
    return pageText.trim().length > 0;
  }).length;
}

/**
 * The processing note as something safe to render, whatever is in the record.
 *
 * `processingNote` is written by this module, so in a freshly read document it
 * is always a string. It also arrives from IMPORTS and cloud restores, and the
 * persisted-state validator's document entry does not list it -- a new field
 * the table has not been taught about -- so a damaged or hand-edited backup can
 * carry `{}` or a number straight through to the screen. React then throws
 * "Objects are not valid as a React child" and takes the Documents page down
 * with it: a defect in a backup becomes a broken app.
 *
 * Guarding at the point of render rather than at the boundary is deliberate for
 * now -- the validator's shape table belongs to the report/store work in
 * progress, and there is exactly one render site -- but the boundary is the
 * better home for it and the table entry would be belt and braces.
 */
export function readableProcessingNote(note: unknown): string {
  return typeof note === 'string' ? note : '';
}

/**
 * A plain sentence for a partial read, or '' when the whole file was examined.
 *
 * Pure, so what the customer is told can be tested without a browser.
 */
/*
 * The two sentences that mean "the reader came away with nothing", exported so
 * the screen can ask that question without parsing prose. This module is their
 * only author, so comparing against these is comparing against the source.
 */
export const UNREADABLE_FILE_NOTE = 'This file could not be read.';
const NO_PAGES_READ = /^None of the \d+ pages could be read\./;

/**
 * Did the read produce nothing at all?
 *
 * Worth asking separately from "was the read partial", because the screen owes
 * a different answer. A partial read still has facts on it and a confidence
 * figure that means something. A read that produced nothing has neither -- and
 * the match confidence shown beside it is a floor (`0.54` when no candidate
 * matched, never below `0.42`), not a measurement. Presenting that as
 * "54% match confidence" next to "This file could not be read." states a
 * precision that was never computed, which is the same dishonesty the coverage
 * reporting exists to remove.
 */
export function extractionProducedNothing(note: unknown): boolean {
  const text = readableProcessingNote(note);
  return text.startsWith(UNREADABLE_FILE_NOTE) || NO_PAGES_READ.test(text);
}

export function describeDocumentCoverage(coverage: DocumentCoverage): string {
  const examined = coverage.pagesRead + coverage.pagesOcrRead;
  const parts: string[] = [];
  if (coverage.readFailed) {
    // Says nothing about pages on purpose: a file that never opened has no page
    // count to report, and inventing "0 pages" would be a claim of its own.
    parts.push(UNREADABLE_FILE_NOTE);
  } else if (coverage.totalPages > 0 && examined === 0) {
    /*
     * Nothing came off the file at all, and this used to say nothing.
     *
     * The `examined > 0` guard below was written for a PARTIAL read and
     * silently covered the total failure too: when every page fails to render
     * or OCR returns nothing for all of them, both counters stay 0, no part is
     * pushed, and the record carries no `processingNote` -- a document read to
     * completion and a document not read at all produced the same silence. That
     * is the exact dishonesty the coverage reporting exists to prevent, and it
     * hid the worst case rather than an edge of it.
     */
    parts.push(`None of the ${coverage.totalPages} pages could be read.`);
  } else if (coverage.totalPages > 0 && examined > 0 && examined < coverage.totalPages) {
    parts.push(`Only ${examined} of ${coverage.totalPages} pages were read.`);
  }
  if (coverage.truncated) {
    parts.push('The text was longer than this reader handles and was cut short.');
  }
  if (parts.length === 0) return '';
  parts.push('Facts on the parts that were not read are missing, not absent.');
  return parts.join(' ');
}

// OCR runtime files are staged same-origin by scripts/prepare-ocr-assets.mjs
// (see that file). Never fall back to the jsdelivr CDN defaults: they break
// behind firewalls/content blockers and defeat offline support.
const OCR_ASSET_PATHS = {
  workerPath: '/ocr/worker.min.js',
  corePath: '/ocr',
  langPath: '/ocr/lang',
};

type OcrWorker = {
  recognize: (
    image: File | Blob | HTMLCanvasElement,
    options?: Record<string, unknown>,
  ) => Promise<{ data: { text: string } }>;
};

let ocrWorkerPromise: Promise<OcrWorker> | null = null;
let pdfJsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
let pdfWorkerUrlPromise: Promise<string> | null = null;

async function getPdfJs() {
  if (!pdfJsPromise) {
    /*
     * The LEGACY build, not the default one, and not a version change.
     *
     * pdfjs-dist 6.2.108 calls `Map.prototype.getOrInsertComputed` -- a TC39
     * proposal method that Chromium 141 does not have, nor Node 22, nor any
     * shipping Safari or Firefox. The default build assumes the runtime
     * provides it; the legacy build ships the polyfill. Without it
     * `page.render()` throws "getOrInsertComputed is not a function" for every
     * page, `renderPdfPageToCanvas` returns null, and the OCR loop skips the
     * page silently -- so a scanned PDF produced no text at all and said
     * nothing. Measured: a three-page PDF with two scanned pages logged
     * `PDF render failed for OCR (page 2)` and `(page 3)` and extracted only
     * the cover sheet.
     *
     * Text-layer extraction was unaffected, which is why this stayed hidden:
     * ordinary text PDFs read fine and only scans came back empty.
     */
    pdfJsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }

  return pdfJsPromise;
}

async function ensurePdfWorkerConfigured() {
  if (typeof window === 'undefined') {
    return;
  }

  const pdfJs = await getPdfJs();
  if (!pdfWorkerUrlPromise) {
    // Must match the build above, or the worker and the main thread disagree.
    pdfWorkerUrlPromise = import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url').then((module) => module.default);
  }

  pdfJs.GlobalWorkerOptions.workerSrc = await pdfWorkerUrlPromise;
}

/*
 * Reports WHETHER it failed, like every other reader here.
 *
 * `file.text()` rejects when the selected local file has become unreadable --
 * moved, unmounted, permission withdrawn between picking it and reading it --
 * and this used to turn that into `''`, which is also what an empty file
 * produces. Three separate findings landed on that same shape (PDF, image and
 * this one) before it was made unrepresentable: every reader now returns
 * `{ text, failed }` and `readOutcome()` is the only thing that builds coverage
 * from it, so a new reader cannot quietly report silence as success.
 */
async function extractPlainText(file: File): Promise<{ text: string; failed: boolean }> {
  try {
    return { text: (await file.text()).trim(), failed: false };
  } catch {
    return { text: '', failed: true };
  }
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = import('tesseract.js').then(async ({ createWorker }) =>
      createWorker('eng', undefined, OCR_ASSET_PATHS),
    );
  }

  return ocrWorkerPromise;
}

/*
 * Returns WHETHER it failed as well as what it read.
 *
 * This used to swallow the error and return '', which made a worker that could
 * not load indistinguishable from a picture with no writing on it. The staged
 * OCR runtime is the ordinary way to get there: blocked or missing assets fail
 * the worker for every image, silently.
 */
async function runImageOcr(image: File | Blob | HTMLCanvasElement): Promise<{ text: string; failed: boolean }> {
  try {
    const worker = await getOcrWorker();
    const result = await worker.recognize(image, { rotateAuto: true });
    return { text: result.data.text.trim(), failed: false };
  } catch (error) {
    console.error('Image OCR failed', error);
    return { text: '', failed: true };
  }
}

function collectTextItems(items: Array<{ str?: string }>) {
  return items
    .map((item) => item.str?.trim() ?? '')
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

type PdfDocument = Awaited<ReturnType<(typeof import('pdfjs-dist'))['getDocument']>['promise']>;

async function renderPdfPageToCanvas(pdf: PdfDocument, pageNumber: number) {
  if (typeof document === 'undefined') {
    return null;
  }

  try {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      return null;
    }

    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);

    await page.render({
      canvas,
      canvasContext: context,
      viewport,
    }).promise;

    return canvas;
  } catch (error) {
    console.error(`PDF render failed for OCR (page ${pageNumber})`, error);
    return null;
  }
}

async function extractPdfText(file: File): Promise<{ text: string; coverage: DocumentCoverage }> {
  try {
    await ensurePdfWorkerConfigured();
    const { getDocument } = await getPdfJs();
    const buffer = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocument({ data: buffer }).promise;
    const pageCount = Math.min(pdf.numPages, PDF_TEXT_PAGE_LIMIT);

    /*
     * Each page decides for itself whether it has a usable text layer.
     *
     * This used to be one decision for the whole document: gather the text
     * layers of the first 8 pages, and if the TOTAL cleared
     * MIN_TEXT_LAYER_CHARS, return it and never OCR anything. A mixed PDF
     * defeats that -- and a mixed PDF is the ordinary shape of a registration
     * sent by a registry or a scanner: a transmittal cover sheet with real
     * text, then the papers themselves as images.
     *
     * Measured on a three-page PDF built that way (a 137-character cover sheet
     * over two scanned pages carrying the registered name, registration number,
     * sex and colour): the cover sheet alone cleared the threshold, both
     * scanned pages were skipped, and the upload produced `entities: {}` --
     * not one fact, with nothing on screen to say two pages had been ignored.
     */
    const pageTexts: string[] = [];
    const pagesWithoutText: number[] = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = collectTextItems(textContent.items as Array<{ str?: string }>);
      pageTexts.push(text);
      if (text.trim().length < MIN_TEXT_LAYER_CHARS) {
        pagesWithoutText.push(pageNumber);
      }
      if (pageTexts.join(' ').length >= TEXT_PREVIEW_LIMIT) {
        break;
      }
    }

    /*
     * OCR only the pages that carry no usable text layer of their own, and only
     * as many as the budget allows -- a fully text-bearing PDF still does no
     * OCR at all, which is what keeps the common case fast.
     */
    const ocrPages = new Set<number>();
    let ocrBudget = PDF_OCR_PAGE_LIMIT;
    for (const pageNumber of pagesWithoutText) {
      if (ocrBudget <= 0 || pageTexts.join(' ').length >= TEXT_PREVIEW_LIMIT) {
        break;
      }
      const canvas = await renderPdfPageToCanvas(pdf, pageNumber);
      if (!canvas) {
        // A page that could not be rendered consumed no OCR, so it must not
        // consume the budget either.
        continue;
      }
      ocrBudget -= 1;
      const { text } = await runImageOcr(canvas);
      // Keep the thin text layer when OCR finds nothing: it is still the best
      // reading of that page available.
      if (text) {
        pageTexts[pageNumber - 1] = text;
        ocrPages.add(pageNumber);
      }
    }

    const text = pageTexts.join(' ').trim();
    return {
      text,
      coverage: {
        totalPages: pdf.numPages,
        pagesRead: countPagesRead(pageTexts, new Set(pagesWithoutText), ocrPages),
        pagesOcrRead: ocrPages.size,
        truncated: text.length > TEXT_PREVIEW_LIMIT,
        // A PDF reports its own shortfall through the page counters: the
        // zero-of-N sentence covers "every page failed" without needing this.
        readFailed: false,
      },
    };
  } catch (error) {
    /*
     * Nothing was read, and `fullCoverage()` would say the opposite.
     *
     * `getDocument`, worker initialisation and text extraction all throw here --
     * a malformed file, a password-protected one, a worker that could not load.
     * The page counters cannot express that: `totalPages` is 0 because the
     * document never opened, so the zero-of-N sentence has no N to speak of and
     * the record looked exactly like a file examined in full.
     *
     * The same shape as the image path, and found the same way: a catch that
     * returns an empty result is indistinguishable from an empty file unless it
     * says which it was.
     */
    console.error('PDF extraction failed', error);
    return { text: '', coverage: { ...fullCoverage(), readFailed: true } };
  }
}

/**
 * What any reader's attempt amounts to, kept out of the call sites on purpose.
 *
 * The mapping from "the reader failed" to "the customer is told" is the whole
 * point, and written inline at a call site it could not be tested:
 * `readDocumentWithCoverage` needs a real tesseract worker for the image path,
 * and that throws asynchronously in node and takes the process with it. With
 * the decision here every branch passes its reader's result through untouched
 * and has no logic left to get wrong.
 */
export function readOutcome(read: { text: string; failed: boolean }): { text: string; coverage: DocumentCoverage } {
  return {
    text: read.text.slice(0, TEXT_PREVIEW_LIMIT),
    coverage: {
      ...fullCoverage(),
      truncated: read.text.length > TEXT_PREVIEW_LIMIT,
      readFailed: read.failed,
    },
  };
}

export async function readDocumentWithCoverage(file: File): Promise<{ text: string; coverage: DocumentCoverage }> {
  if (file.type.startsWith('text/') || /\.(txt|csv|json|md)$/i.test(file.name)) {
    return readOutcome(await extractPlainText(file));
  }

  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const { text, coverage } = await extractPdfText(file);
    return { text: text.slice(0, TEXT_PREVIEW_LIMIT), coverage };
  }

  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(file.name)) {
    return readOutcome(await runImageOcr(file));
  }

  // A type this reader has no opinion about: nothing was attempted, so nothing
  // failed. Silence here is honest.
  return { text: '', coverage: fullCoverage() };
}

export async function readDocumentText(file: File) {
  return (await readDocumentWithCoverage(file)).text;
}
