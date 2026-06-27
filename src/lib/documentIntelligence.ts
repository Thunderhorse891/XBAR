const TEXT_PREVIEW_LIMIT = 1200;

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
    ocrWorkerPromise = import('tesseract.js').then(async ({ createWorker }) => createWorker('eng'));
  }

  return ocrWorkerPromise;
}

async function runImageOcr(image: File | Blob | HTMLCanvasElement) {
  try {
    const worker = await getOcrWorker();
    const result = await worker.recognize(image, { rotateAuto: true });
    return result.data.text.trim();
  } catch {
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

async function renderPdfPageToCanvas(file: File) {
  if (typeof document === 'undefined') {
    return null;
  }

  try {
    await ensurePdfWorkerConfigured();
    const { getDocument } = await getPdfJs();
    const buffer = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocument({ data: buffer }).promise;
    const page = await pdf.getPage(1);
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
  } catch {
    return null;
  }
}

async function extractPdfText(file: File) {
  try {
    await ensurePdfWorkerConfigured();
    const { getDocument } = await getPdfJs();
    const buffer = new Uint8Array(await file.arrayBuffer());
    const pdf = await getDocument({ data: buffer }).promise;
    const pageCount = Math.min(pdf.numPages, 3);
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
    if (combined) {
      return combined;
    }

    const canvas = await renderPdfPageToCanvas(file);
    if (!canvas) {
      return '';
    }

    return runImageOcr(canvas);
  } catch {
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
