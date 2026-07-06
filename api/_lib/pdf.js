import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

const PAGE_WIDTH = 612; // US Letter
const PAGE_HEIGHT = 792;
const MARGIN = 56;
const BODY_SIZE = 11;
const HEADING_SIZE = 14;
const TITLE_SIZE = 20;
const LINE_GAP = 5;

function wrapLine(text, font, size, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];

  const lines = [];
  let current = '';
  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(attempt, size) <= maxWidth || !current) {
      current = attempt;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Renders { title, sections: [{ heading, lines }], footer } into a paginated
// US Letter PDF. Returns a Uint8Array.
export async function createSectionedPdf({ title, sections, footer = '' }) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const maxWidth = PAGE_WIDTH - MARGIN * 2;

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const ensureRoom = (needed) => {
    if (y - needed < MARGIN) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };

  const drawWrapped = (text, options) => {
    const lines = wrapLine(text, options.font, options.size, maxWidth);
    for (const line of lines) {
      ensureRoom(options.size + LINE_GAP);
      page.drawText(line, {
        x: MARGIN,
        y: y - options.size,
        size: options.size,
        font: options.font,
        color: rgb(0.1, 0.1, 0.12),
      });
      y -= options.size + LINE_GAP;
    }
  };

  drawWrapped(title, { font: bold, size: TITLE_SIZE });
  y -= 8;

  for (const section of sections || []) {
    ensureRoom(HEADING_SIZE + 18);
    y -= 10;
    drawWrapped(section.heading, { font: bold, size: HEADING_SIZE });
    for (const line of section.lines || []) {
      drawWrapped(line, { font, size: BODY_SIZE });
    }
  }

  if (footer) {
    const pages = pdf.getPages();
    for (const footerPage of pages) {
      footerPage.drawText(footer, {
        x: MARGIN,
        y: MARGIN / 2,
        size: 8,
        font,
        color: rgb(0.45, 0.45, 0.5),
      });
    }
  }

  return pdf.save();
}

async function appendAttachment(pdf, attachment, fallbackNotes) {
  const mime = (attachment.mimeType || '').toLowerCase();
  const bytes = attachment.bytes;

  try {
    if (mime === 'application/pdf') {
      const source = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pages = await pdf.copyPages(source, source.getPageIndices());
      for (const copied of pages) pdf.addPage(copied);
      return true;
    }

    if (mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/png') {
      const image = mime === 'image/png' ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      const maxWidth = PAGE_WIDTH - MARGIN * 2;
      const maxHeight = PAGE_HEIGHT - MARGIN * 2;
      const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
      const width = image.width * scale;
      const height = image.height * scale;
      page.drawImage(image, {
        x: (PAGE_WIDTH - width) / 2,
        y: (PAGE_HEIGHT - height) / 2,
        width,
        height,
      });
      return true;
    }
  } catch (error) {
    fallbackNotes.push(`${attachment.label || 'Attachment'}: could not be embedded (${error.message}).`);
    return false;
  }

  fallbackNotes.push(
    `${attachment.label || 'Attachment'}: unsupported format (${mime || 'unknown'}), available separately.`,
  );
  return false;
}

export async function applyWatermark(pdf, watermarkText) {
  if (!watermarkText) return;
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const size = Math.min(42, (width * 1.4) / Math.max(watermarkText.length, 8));
    const textWidth = font.widthOfTextAtSize(watermarkText, size);
    page.drawText(watermarkText, {
      x: width / 2 - textWidth / 2.8,
      y: height / 5,
      size,
      font,
      color: rgb(0.6, 0.1, 0.1),
      opacity: 0.16,
      rotate: degrees(38),
    });
  }
}

// Assembles a sale packet: cover sheet first, then every attachment (PDFs are
// merged page-by-page, JPEG/PNG become full pages, anything else is listed on
// an appendix note). The watermark is stamped on every page at the end.
export async function assemblePacketPdf({ coverBytes, attachments = [], watermarkText = '' }) {
  const pdf = await PDFDocument.create();
  const fallbackNotes = [];

  if (coverBytes) {
    const cover = await PDFDocument.load(coverBytes);
    const pages = await pdf.copyPages(cover, cover.getPageIndices());
    for (const copied of pages) pdf.addPage(copied);
  }

  for (const attachment of attachments) {
    await appendAttachment(pdf, attachment, fallbackNotes);
  }

  if (fallbackNotes.length) {
    const noteBytes = await createSectionedPdf({
      title: 'Appendix: Items Not Embedded',
      sections: [{ heading: 'Notes', lines: fallbackNotes }],
    });
    const notes = await PDFDocument.load(noteBytes);
    const pages = await pdf.copyPages(notes, notes.getPageIndices());
    for (const copied of pages) pdf.addPage(copied);
  }

  await applyWatermark(pdf, watermarkText);
  return pdf.save();
}
