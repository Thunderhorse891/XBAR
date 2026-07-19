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
    pdfJsPromise = import('pdfjs-dist');
  }

  return pdfJsPromise;
}

async function ensurePdfWorkerConfigured() {
  if (typeof window === 'undefined') {
    return;
  }

  const pdfJs = await getPdfJs();
  if (!pdfWorkerUrlPromise) {
    pdfWorkerUrlPromise = import('pdfjs-dist/build/pdf.worker.min.mjs?url').then((module) => module.default);
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
    const chunks: string[] = [];

    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const text = collectTextItems(textContent.items as Array<{ str?: string }>);
      if (text) {
        chunks.push(text);
      }
      if (chunks.join(' ').length >= TEXT_PREVIEW_LIMIT) {
        break;
      }
    }

    const combined = chunks.join(' ').trim();
    if (combined.length >= MIN_TEXT_LAYER_CHARS) {
      return combined;
    }

    // No usable text layer — scanned document. OCR the first few pages, and
    // fall back to whatever thin text layer we did find if OCR comes up empty.
    const ocrPageCount = Math.min(pdf.numPages, PDF_OCR_PAGE_LIMIT);
    const ocrChunks: string[] = [];
    for (let pageNumber = 1; pageNumber <= ocrPageCount; pageNumber += 1) {
      const canvas = await renderPdfPageToCanvas(pdf, pageNumber);
      if (!canvas) {
        continue;
      }
      const text = await runImageOcr(canvas);
      if (text) {
        ocrChunks.push(text);
      }
      if (ocrChunks.join(' ').length >= TEXT_PREVIEW_LIMIT) {
        break;
      }
    }

    return ocrChunks.join(' ').trim() || combined;
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
