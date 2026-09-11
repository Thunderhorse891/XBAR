const TEXT_PREVIEW_LIMIT = 12000;
const PDF_TEXT_PAGE_LIMIT = 8;
const PDF_OCR_PAGE_LIMIT = 3;
// Scanned registration papers often carry a token text layer (a title or form
// labels) while the real horse data lives in the page image. Below this many
// characters we treat the text layer as unusable and fall through to OCR.
const MIN_TEXT_LAYER_CHARS = 60;

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

async function extractPlainText(file: File) {
  try {
    return (await file.text()).trim();
  } catch {
    return '';
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

async function runImageOcr(image: File | Blob | HTMLCanvasElement) {
  try {
    const worker = await getOcrWorker();
    const result = await worker.recognize(image, { rotateAuto: true });
    return result.data.text.trim();
  } catch (error) {
    console.error('Image OCR failed', error);
    return '';
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

async function extractPdfText(file: File) {
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
      const text = await runImageOcr(canvas);
      // Keep the thin text layer when OCR finds nothing: it is still the best
      // reading of that page available.
      if (text) {
        pageTexts[pageNumber - 1] = text;
      }
    }

    return pageTexts.join(' ').trim();
  } catch (error) {
    console.error('PDF extraction failed', error);
    return '';
  }
}

export async function readDocumentText(file: File) {
  if (file.type.startsWith('text/') || /\.(txt|csv|json|md)$/i.test(file.name)) {
    return (await extractPlainText(file)).slice(0, TEXT_PREVIEW_LIMIT);
  }

  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    return (await extractPdfText(file)).slice(0, TEXT_PREVIEW_LIMIT);
  }

  if (file.type.startsWith('image/') || /\.(png|jpe?g|webp|bmp|gif|tiff?)$/i.test(file.name)) {
    return (await runImageOcr(file)).slice(0, TEXT_PREVIEW_LIMIT);
  }

  return '';
}
