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

/*
 * Clear space between the longest inline label and the value beside it.
 *
 * A label is drawn unwrapped at the left margin while its value starts at a
 * fixed column, so a label wider than the column runs straight through the
 * value. `asField` accepts labels up to 40 characters, and a horse name is a
 * label here — `Thunderhorse Quarter Horse Champion` measures about 198pt in
 * Helvetica-Bold at body size, 30pt past the column, and overprinted the
 * status and the money beside it on the banker-facing page.
 */
const LABEL_GUTTER = 10;

const INK = rgb(0.09, 0.1, 0.13);
const MUTED = rgb(0.42, 0.45, 0.5);
const RULE = rgb(0.82, 0.84, 0.87);
const ACCENT = rgb(0.16, 0.35, 0.55);

/*
 * Everything drawn here goes through pdf-lib's standard Helvetica, which is
 * WinAnsi-encoded (CP1252). Handing it anything outside that set does not
 * degrade — it THROWS, so one horse called `Dvořák` fails the whole document.
 *
 * Verified against pdf-lib by probing every codepoint to 0x2FFF; the encodable
 * set is exactly CP1252:
 *
 *   0x20-0x7E, 0xA0-0xFF, and the scattered extras — Œœ Šš Ÿ Žž ƒ ˆ ˜
 *   – — ' ' ‚ " " „ † ‡ • … ‰ ‹ › € ™
 *
 * Embedding a Unicode font would be the complete fix, but that needs fontkit
 * and a multi-megabyte typeface — a new dependency and a much larger bundle.
 * Failing to produce a bill of sale is far worse than producing one that spells
 * a name without its háčeks, so unsupported characters are folded down instead:
 * accents are decomposed to their base letter (ř becomes r, ñ becomes n), and
 * anything with no Latin equivalent at all — CJK, emoji — becomes '?' so the
 * rest of the document still renders.
 */
const WINANSI_EXTRAS = new Set([
  0x152, 0x153, 0x160, 0x161, 0x178, 0x17d, 0x17e, 0x192, 0x2c6, 0x2dc, 0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c,
  0x201d, 0x201e, 0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203a, 0x20ac, 0x2122,
]);

/*
 * Letters whose accent is a stroke through the glyph rather than a combining
 * mark. NFKD leaves them intact, so they need naming explicitly or a Polish or
 * Croatian owner surname renders as '?ukasz'.
 */
/** Clear space kept between the footer text and the right-aligned page stamp. */
const FOOTER_GAP = 12;

/**
 * Shorten text to fit a width, ending with an ellipsis when it had to be cut.
 *
 * Used where wrapping is not available — the footer has only the page margin
 * beneath it, so a second line would fall outside the document's frame.
 */
function truncateToWidth(value, font, size, maxWidth) {
  const text = String(value ?? '');
  if (maxWidth <= 0) return '';
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;

  const ellipsis = '...';
  const room = maxWidth - font.widthOfTextAtSize(ellipsis, size);
  if (room <= 0) return '';

  let out = '';
  for (const char of text) {
    if (font.widthOfTextAtSize(out + char, size) > room) break;
    out += char;
  }
  return `${out.trimEnd()}${ellipsis}`;
}

/*
 * Whitespace that carries no glyph. These are not "unsupported characters" to
 * be replaced — they are separators, and the wrapper already treats them as
 * such, so they collapse to a space.
 */
const WHITESPACE_CONTROLS = new Set(['\t', '\n', '\r', '\v', '\f', '\u0085', '\u2028', '\u2029']);

const STROKED_LATIN = new Map([
  ['\u0141', 'L'],
  ['\u0142', 'l'],
  ['\u0110', 'D'],
  ['\u0111', 'd'],
  ['\u0126', 'H'],
  ['\u0127', 'h'],
  ['\u0166', 'T'],
  ['\u0167', 't'],
]);

function encodable(codePoint) {
  if (codePoint >= 0x20 && codePoint <= 0x7e) return true;
  if (codePoint >= 0xa0 && codePoint <= 0xff) return true;
  return WINANSI_EXTRAS.has(codePoint);
}

/**
 * Fold a string down to what the standard font can actually draw.
 *
 * Applied once, at the entry to createSectionedPdf, so measuring and drawing
 * always see the same string. Sanitizing at draw time instead would wrap on one
 * string and render another, and the layout would drift by however much the
 * substitutions changed the width.
 */
export function toDrawableText(value) {
  const raw = String(value ?? '');
  let out = '';

  for (const char of raw) {
    // Kept exactly as written whenever the font can draw it. CP1252 already
    // covers é, ñ, ü, ç and the rest of Latin-1, so folding first would spell
    // `Café` as `Cafe` for no reason.
    if (encodable(char.codePointAt(0))) {
      out += char;
      continue;
    }

    // Whitespace controls become spaces, never '?'. wrapLine splits on /\s+/,
    // so before this fold a newline inside a value acted as a word break — a
    // multiline medical note wrapped naturally. Turning it into a literal '?'
    // both printed a spurious character and welded the two lines together.
    if (WHITESPACE_CONTROLS.has(char)) {
      out += ' ';
      continue;
    }

    const stroked = STROKED_LATIN.get(char);
    if (stroked) {
      out += stroked;
      continue;
    }

    // NFKD splits an accented letter into base + combining mark; dropping the
    // marks leaves a base letter the font can draw. This is what turns ř into
    // r.
    const folded = char.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
    const drawable = [...folded].every((part) => encodable(part.codePointAt(0)));

    // No Latin equivalent — CJK, emoji. A visible placeholder beats a silent
    // deletion, which would render two different horses under the same name.
    out += drawable && folded ? folded : '?';
  }

  return out;
}

/*
 * Characters a long unbroken token may be split after.
 *
 * Breaking a URL after a separator keeps the fragments legible and lets a
 * reader retype the address from the page. Splitting mid-word is the fallback,
 * not the goal.
 */
const TOKEN_BREAK_AFTER = new Set(['/', '?', '&', '=', '-', '_', '.', ',', ';', ':', '#', '+', '~', '%']);

/**
 * Split a single token that is wider than the column it has to fit in.
 *
 * Every returned chunk fits, which is the whole point: the caller cannot wrap
 * on whitespace because there is none.
 */
function breakToken(word, font, size, maxWidth) {
  const chunks = [];
  let current = '';
  // Offset within `current` just past the most recent separator.
  let lastBreak = -1;

  for (const char of word) {
    const attempt = current + char;
    // `!current` lets a single character through even in a column too narrow
    // to hold it, so a pathological width cannot loop forever.
    if (font.widthOfTextAtSize(attempt, size) <= maxWidth || !current) {
      current = attempt;
      if (TOKEN_BREAK_AFTER.has(char)) lastBreak = current.length;
      continue;
    }

    // Prefer ending the chunk after a separator, unless doing so would throw
    // away most of a line that is already full.
    if (lastBreak > 0 && lastBreak >= current.length / 2) {
      chunks.push(current.slice(0, lastBreak));
      current = current.slice(lastBreak) + char;
    } else {
      chunks.push(current);
      current = char;
    }
    lastBreak = TOKEN_BREAK_AFTER.has(char) ? current.length : -1;
  }

  if (current) chunks.push(current);
  return chunks;
}

/*
 * Wrap text to a column width.
 *
 * Splits on whitespace, and falls back to breaking a token that has none. That
 * fallback is not theoretical: the sale-packet cover renders
 * `Verify this packet: <origin>/app/verify/<packetId>`, and with the deployed
 * origin that URL measures ~353pt against a 332pt value column — it was emitted
 * whole and drawn past the right margin, and a longer packet id ran clean off
 * the 612pt page, taking the verification link with it.
 */
export function wrapLine(text, font, size, maxWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];

  const lines = [];
  let current = '';
  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(attempt, size) <= maxWidth) {
      current = attempt;
      continue;
    }

    // Does not fit beside what is already on the line, so end that line first.
    if (current) {
      lines.push(current);
      current = '';
    }

    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word;
      continue;
    }

    // Wider than the column on its own. Previously the `!current` escape here
    // accepted it whole and let it draw past the page edge.
    const pieces = breakToken(word, font, size, maxWidth);
    lines.push(...pieces.slice(0, -1));
    current = pieces[pieces.length - 1];
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

export async function createSectionedPdf(input) {
  // Folded once, here, so every downstream measurement and draw sees the same
  // text. See toDrawableText: the standard font throws on anything outside
  // CP1252, so one unusual character in one horse's name would otherwise fail
  // the entire document.
  const title = toDrawableText(input.title);
  const footer = toDrawableText(input.footer ?? '');
  const letterhead = toDrawableText(input.letterhead ?? '');
  const reference = toDrawableText(input.reference ?? '');
  const sections = (input.sections || []).map((section) => ({
    ...section,
    heading: toDrawableText(section.heading),
    lines: (section.lines || []).map(toDrawableText),
  }));

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
  //
  // Wrapped like everything else. This was drawn as a single unbounded line, so
  // a long ranch name — Settings imposes no limit on it — ran past the right
  // edge and was clipped, on the one line of the page that says whose document
  // it is. The title directly below it has always wrapped.
  if (letterhead) {
    const lines = wrapLine(letterhead, bold, 10, maxWidth);
    ensureRoom(lines.length * 14 + 16);
    for (const line of lines) {
      text(line, MARGIN, 10, bold, ACCENT);
      y -= 12;
    }
    y -= 4;
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

    /*
     * How a label that will not fit its column has to be drawn.
     *
     * Returns null for a label that fits, leaving it to be drawn inline as
     * before — which is nearly every label in nearly every template. Only the
     * oversized case stacks, so the columns the rest of the page is built on
     * survive.
     *
     * Measured separately from drawing so the caller can reserve room for the
     * label AND its value together. Drawing the label first advanced `y` before
     * anything had checked whether the value still fitted, which stranded the
     * label at the foot of a page with its value overleaf — the exact thing the
     * reservation below exists to prevent.
     */
    const oversizedLabelLines = (label) =>
      bold.widthOfTextAtSize(label, BODY_SIZE) <= LABEL_WIDTH - LABEL_GUTTER
        ? null
        : wrapLine(label, bold, BODY_SIZE, maxWidth);

    const drawLabelLines = (labelLines) => {
      for (const labelLine of labelLines) {
        // Only reachable for a label taller than a whole page; the block
        // reservation at each call site covers everything else.
        ensureRoom(BODY_SIZE + LINE_GAP);
        text(labelLine, MARGIN, BODY_SIZE, bold, MUTED);
        y -= BODY_SIZE + LINE_GAP;
      }
    };

    for (const line of section.lines || []) {
      const fields = fieldsInLine(line);
      if (fields) {
        for (const field of fields) {
          if (!field.value) {
            // A blank to fill in: label, then a ruled space the width of the
            // value column, so a printed document can be completed by hand.
            const blankLabelLines = oversizedLabelLines(field.label);
            ensureRoom((blankLabelLines?.length ?? 0) * (BODY_SIZE + LINE_GAP) + BODY_SIZE + LINE_GAP + 6);
            if (blankLabelLines) drawLabelLines(blankLabelLines);
            else text(field.label, MARGIN, BODY_SIZE, bold, MUTED);
            page.drawLine({
              start: { x: MARGIN + LABEL_WIDTH, y: y - BODY_SIZE + 1 },
              end: { x: PAGE_WIDTH - MARGIN, y: y - BODY_SIZE + 1 },
              thickness: 0.6,
              color: RULE,
            });
            y -= BODY_SIZE + LINE_GAP + 4;
            continue;
          }

          const labelLines = oversizedLabelLines(field.label);
          const valueLines = wrapLine(field.value, font, BODY_SIZE, maxWidth - LABEL_WIDTH);
          // Room for the whole block — the stacked label's lines included — so
          // a label never sits alone at the foot of a page with its value
          // overleaf.
          ensureRoom(((labelLines?.length ?? 0) + valueLines.length) * (BODY_SIZE + LINE_GAP));
          if (labelLines) drawLabelLines(labelLines);
          else text(field.label, MARGIN, BODY_SIZE, bold, MUTED);
          for (const valueLine of valueLines) {
            // Checked BEFORE drawing, like paragraph() does. Checking after
            // each line meant the last line of the last field could start a
            // page for a line that was never coming — a trailing sheet
            // carrying nothing but the footer and "Page 2 of 2". The block
            // reservation above covers the common case; this catches a block
            // taller than a page, where it cannot.
            ensureRoom(BODY_SIZE + LINE_GAP);
            text(valueLine, MARGIN + LABEL_WIDTH, BODY_SIZE, font, INK);
            y -= BODY_SIZE + LINE_GAP;
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
    // The stamp is placed first so the footer knows how much room is left.
    // Both are drawn on the same baseline — the footer from the left, the
    // stamp from the right — and the footer carries an unbounded workspace
    // business name, so without a reserved gap a long legal name runs straight
    // through "Page N of M" and neither is readable. A 90-character name
    // overlapped by 27pt.
    const stamp = `Page ${index + 1} of ${pages.length}`;
    const stampWidth = font.widthOfTextAtSize(stamp, 8);
    footerPage.drawText(stamp, {
      x: PAGE_WIDTH - MARGIN - stampWidth,
      y: MARGIN - 20,
      size: 8,
      font,
      color: MUTED,
    });

    if (footer) {
      // Truncated rather than wrapped: this sits below the footer rule with
      // only the page margin beneath it, so a second line would print outside
      // the document's own frame. The page stamp is the part that must stay
      // legible — a reader needs to know whether they have the whole document.
      const available = PAGE_WIDTH - 2 * MARGIN - stampWidth - FOOTER_GAP;
      footerPage.drawText(truncateToWidth(footer, font, 8, available), {
        x: MARGIN,
        y: MARGIN - 20,
        size: 8,
        font,
        color: MUTED,
      });
    }
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
