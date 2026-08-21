import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

const PAGE_WIDTH = 612; // US Letter
const PAGE_HEIGHT = 792;
const MARGIN = 56;
const BODY_SIZE = 10.5;
const HEADING_SIZE = 12;
const TITLE_SIZE = 22;
const LINE_GAP = 6;
const SECTION_GAP = 18;

// A label column wide enough for the longest label the templates actually use
// ("Registration number", "Balance due on or before"), so values line up down
// the page instead of starting wherever the label happened to end.
const LABEL_WIDTH = 168;

const INK = rgb(0.09, 0.1, 0.13);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.82, 0.84, 0.87);
const ACCENT = rgb(0.16, 0.35, 0.55);

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

/*
 * Templates express almost everything as "Label: value", often several to a
 * line separated by wide spaces:
 *
 *   Breed: {{horse.breed}}    Color: {{horse.color}}    Sex: {{horse.gender}}
 *
 * Rendering those as running text is what made these read like a memo rather
 * than a document: the reader has to scan each line to find where one field
 * ends and the next begins. Splitting them into stacked label/value rows is the
 * single largest change here, and it applies to nearly every line of every
 * template without any template being rewritten.
 */
const BLANK_RUN = /_{3,}/g;

export function asField(part) {
  const match = /^([^:]{1,40}):\s*(.*)$/.exec(String(part).trim());
  if (!match) return null;

  // A run of underscores is a space to write in — that is how the templates
  // write signature and date lines, and it is also what renderPlaceholders
  // substitutes for a value the workspace has not filled in yet. Both mean the
  // same thing to whoever is holding the page, so both become a ruled blank
  // rather than a row of typed underscores.
  //
  // Stripped rather than tested for, because a value can be partly known:
  // "Registration #: {{registrationNumber}} ({{registry}})" with no registry
  // yields "AQHA 5488210 (____________)". Blanking the whole field there would
  // drop a real registration number off a bill of sale. What survives the strip
  // is what the workspace actually knows; only an empty residue is a blank.
  const value = match[2]
    .replace(BLANK_RUN, ' ')
    .replace(/\(\s*\)/g, '') // an empty parenthetical left by a missing value
    .replace(/\s{2,}/g, ' ')
    .trim();

  return { label: match[1].trim(), value };
}

/** One line, split into the fields it actually contains, or null if it is prose. */
export function fieldsInLine(line) {
  const parts = String(line)
    .split(/\s{2,}/)
    .filter(Boolean);
  if (!parts.length) return null;

  const fields = parts.map(asField);
  // All or nothing: a line that is part field and part prose is left as prose,
  // because splitting it would strand the prose in a value column.
  return fields.every(Boolean) ? fields : null;
}

export async function createSectionedPdf({ title, sections, footer = '', letterhead = '', reference = '' }) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const maxWidth = PAGE_WIDTH - MARGIN * 2;

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  const newPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    // Room reserved at the foot of every page for the footer rule and text.
    y = PAGE_HEIGHT - MARGIN;
  };

  const ensureRoom = (needed) => {
    if (y - needed < MARGIN + 28) newPage();
  };

  const text = (value, x, size, useFont, color) => {
    page.drawText(String(value), { x, y: y - size, size, font: useFont, color });
  };

  const paragraph = (value, { size = BODY_SIZE, useFont = font, color = INK, indent = 0 } = {}) => {
    for (const line of wrapLine(value, useFont, size, maxWidth - indent)) {
      ensureRoom(size + LINE_GAP);
      text(line, MARGIN + indent, size, useFont, color);
      y -= size + LINE_GAP;
    }
  };

  const rule = (color = RULE, inset = 0) => {
    ensureRoom(8);
    page.drawLine({
      start: { x: MARGIN + inset, y },
      end: { x: PAGE_WIDTH - MARGIN, y },
      thickness: 0.75,
      color,
    });
    y -= 8;
  };

  // Letterhead: whose document this is, before what it is.
  if (letterhead) {
    ensureRoom(30);
    text(letterhead, MARGIN, 10, bold, ACCENT);
    y -= 16;
  }

  paragraph(title, { size: TITLE_SIZE, useFont: bold });
  if (reference) {
    y -= 2;
    paragraph(reference, { size: 9, color: MUTED });
  }
  y -= 4;
  rule(ACCENT);
  y -= 6;

  for (const section of sections || []) {
    // Keep a heading with at least its first line, so a section never starts
    // alone at the foot of a page.
    ensureRoom(HEADING_SIZE + BODY_SIZE + SECTION_GAP);
    y -= SECTION_GAP - LINE_GAP;
    paragraph(section.heading, { size: HEADING_SIZE, useFont: bold });
    y -= 2;
    rule();

    for (const line of section.lines || []) {
      const fields = fieldsInLine(line);
      if (fields) {
        for (const field of fields) {
          if (!field.value) {
            // A blank to fill in: label, then a ruled space the width of the
            // value column, so a printed document can be completed by hand.
            ensureRoom(BODY_SIZE + LINE_GAP + 6);
            text(field.label, MARGIN, BODY_SIZE, bold, MUTED);
            page.drawLine({
              start: { x: MARGIN + LABEL_WIDTH, y: y - BODY_SIZE + 1 },
              end: { x: PAGE_WIDTH - MARGIN, y: y - BODY_SIZE + 1 },
              thickness: 0.6,
              color: RULE,
            });
            y -= BODY_SIZE + LINE_GAP + 4;
            continue;
          }

          const valueLines = wrapLine(field.value, font, BODY_SIZE, maxWidth - LABEL_WIDTH);
          ensureRoom(valueLines.length * (BODY_SIZE + LINE_GAP));
          text(field.label, MARGIN, BODY_SIZE, bold, MUTED);
          for (const valueLine of valueLines) {
            text(valueLine, MARGIN + LABEL_WIDTH, BODY_SIZE, font, INK);
            y -= BODY_SIZE + LINE_GAP;
            ensureRoom(BODY_SIZE + LINE_GAP);
          }
        }
        continue;
      }

      paragraph(line);
    }
  }

  // Footer on every page: who generated it, and where the reader is in it.
  // "Page 2" alone does not tell anyone whether they have the whole document.
  const pages = pdf.getPages();
  pages.forEach((footerPage, index) => {
    footerPage.drawLine({
      start: { x: MARGIN, y: MARGIN - 6 },
      end: { x: PAGE_WIDTH - MARGIN, y: MARGIN - 6 },
      thickness: 0.5,
      color: RULE,
    });
    if (footer) {
      footerPage.drawText(footer, { x: MARGIN, y: MARGIN - 20, size: 8, font, color: MUTED });
    }
    const stamp = `Page ${index + 1} of ${pages.length}`;
    footerPage.drawText(stamp, {
      x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(stamp, 8),
      y: MARGIN - 20,
      size: 8,
      font,
      color: MUTED,
    });
  });

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
