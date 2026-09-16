/*
 * Recover a horse's name from the name of the file its paper arrived in.
 *
 * This exists because of what the alternative was. When a registration paper's
 * OCR text carries no *labelled* name -- which is most scans, since the
 * registered name is usually printed large in its own box and the flattened
 * text loses the label's adjacency -- profile creation used to fall back to the
 * registration NUMBER and store that in the name field. A bulk intake of twenty
 * papers produced twenty horses called 35012691962, 539882319930, 52793571973,
 * and nothing reported a fault: every step "succeeded".
 *
 * A number is not a name, and the filename very often is one. Ranch scans come
 * off a phone or a desktop folder as "Bar B Joseywood pedigree.pdf" or
 * "Berry Peachy Chic - Copy - Copy.pdf". That is the horse's name with clutter
 * around it, and the clutter is predictable enough to remove.
 *
 * What this deliberately does NOT do is rescue "scan-001.jpg". A filename with
 * no name in it yields undefined, the caller creates no profile, and the
 * document waits in review for a person to assign it. Refusing to guess is the
 * point: the failure this replaces was a guess that looked like an answer.
 */

// Words that describe the PAPER rather than the horse. Stripped only from the
// start or end of the name, never the middle, so a horse legitimately called
// "Docs Sale Bound" keeps its middle word.
const DOCUMENT_WORDS = [
  'pedigree',
  'registration',
  'registered',
  'reg',
  'papers',
  'paper',
  'certificate',
  'cert',
  'coggins',
  'insurance',
  'transfer',
  'ownership',
  'owner',
  'memo',
  'breeding',
  'contract',
  'medical',
  'health',
  'vet',
  'exam',
  'record',
  'records',
  'packet',
  'media',
  'photo',
  'photos',
  'scan',
  'scanned',
  'scannedimage',
  'document',
  'doc',
  'file',
  'copy',
  'final',
  'updated',
  'new',
  'front',
  'back',
  'page',
  'img',
  'image',
];

const DOCUMENT_WORD_GROUP = DOCUMENT_WORDS.join('|');

// "- Copy", "- Copy (2)", " (1)", "-kopie": what a file manager adds when the
// same paper is duplicated, which is how "Berry Peachy Chic - Copy - Copy"
// happens. Repeated until none is left, because they stack.
const COPY_SUFFIX = new RegExp(String.raw`[\s._-]*(?:-\s*)?copy(?:\s*\(\d+\))?\s*$|[\s._-]*\(\d+\)\s*$`, 'i');

const LEADING_DOCUMENT_WORD = new RegExp(String.raw`^(?:${DOCUMENT_WORD_GROUP})\b[\s._-]*`, 'i');
const TRAILING_DOCUMENT_WORD = new RegExp(String.raw`[\s._-]*\b(?:${DOCUMENT_WORD_GROUP})$`, 'i');

/*
 * A filing year on the end: "Miss Kitty Jr coggins 2026". Removed in the same
 * loop as the paper words, so peeling the year exposes the word behind it and
 * the next pass takes that too.
 */
const TRAILING_YEAR = /[\s._-]*(?:19|20)\d{2}$/;

// A camera or scanner filename with no name in it at all: scan001, IMG_4821,
// DSC 0001, 20260916_113244, "Untitled 3".
const SCAN_ARTIFACT = new RegExp(String.raw`^(?:scan|img|image|dsc|dscn|photo|pic|untitled|new)?[\s._-]*\d+$`, 'i');

function stripExtension(value: string) {
  // Only an extension-shaped tail. A horse called "Miss Kitty Jr" keeps "Jr",
  // and "blue valentine dot com" keeps "com" -- there is no dot before it.
  return value.replace(/\.[A-Za-z0-9]{2,5}$/, '');
}

function tidySeparators(value: string) {
  return value
    .replace(/[_]+/g, ' ')
    .replace(/\s*-\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.\-_]+|[\s.\-_]+$/g, '')
    .trim();
}

/**
 * The horse's name as carried by a document's title, or undefined when the
 * title holds no name worth using.
 *
 * Callers must treat undefined as "do not create a profile", not as a cue to
 * substitute something else.
 */
export function horseNameFromDocumentTitle(title: string | undefined): string | undefined {
  if (!title) return undefined;

  let value = stripExtension(title.trim());

  // Copy markers first: "Berry Peachy Chic - Copy - Copy" needs two passes, and
  // they sit outside the document words rather than among them.
  let previous: string;
  do {
    previous = value;
    value = value.replace(COPY_SUFFIX, '');
  } while (value !== previous && value.length > 0);

  value = tidySeparators(value);

  // Then the paper words, from both ends, repeatedly: "registration papers
  // Bar B Joseywood pedigree" sheds three.
  do {
    previous = value;
    value = tidySeparators(
      value.replace(LEADING_DOCUMENT_WORD, '').replace(TRAILING_DOCUMENT_WORD, '').replace(TRAILING_YEAR, ''),
    );
  } while (value !== previous && value.length > 0);

  if (!value) return undefined;
  if (SCAN_ARTIFACT.test(value)) return undefined;

  // A registration number in the filename is the very thing this exists to
  // avoid putting in the name field.
  if (!/[A-Za-z]/.test(value)) return undefined;

  // One stray letter beside a number ("a4", "p 12") is not a name either.
  const letters = value.replace(/[^A-Za-z]/g, '');
  if (letters.length < 2) return undefined;

  return value;
}

/**
 * What a profile built from these papers should be called, or undefined when
 * nothing readable names it.
 *
 * The whole decision lives here rather than at the call site so it can be
 * executed by a test: the store module it is called from imports through Vite's
 * `@/` alias and cannot be compiled by the node test runner, which is exactly
 * how the registration-number fallback went unnoticed.
 *
 * Undefined means CREATE NOTHING. There is no third option and no substitute
 * value -- a registration number, a filename with no name in it, and a
 * placeholder are all worse than leaving the document in review for a person to
 * assign.
 */
export function resolveHorseNameForProfile(params: {
  /** A name read from the paper's own text, which always wins when present. */
  extractedName?: string;
  /** Titles of the READABLE documents only, in the order they were grouped. */
  documentTitles: readonly (string | undefined)[];
}): string | undefined {
  const extracted = params.extractedName?.trim();
  if (extracted) return extracted;

  return params.documentTitles.map((title) => horseNameFromDocumentTitle(title)).find(Boolean) ?? undefined;
}
