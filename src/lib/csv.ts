/*
 * Shared CSV field escaping for every spreadsheet export.
 *
 * A single copy on purpose: costPerHorseExport.ts and ranchReportExport.ts
 * once carried independent copies of this formula-injection guard, and a
 * hardening change to one could silently leave the other vulnerable to
 * spreadsheet formula injection. Any new CSV export uses these.
 */

/*
 * Characters that make a spreadsheet treat a cell as a formula rather than as
 * text. Quoting does not help: Excel, LibreOffice and Sheets all parse a
 * leading `=`, `+`, `-` or `@` inside a quoted field.
 *
 * The leading run of whitespace and control characters is SKIPPED rather than
 * enumerated. The first version of this guard listed tab and carriage return
 * and missed line feed — which a hand-edited backup carries straight into a
 * horse name or an expense category, and which several spreadsheets step over
 * before parsing the cell. Vertical tab, form feed, NUL and the Unicode spaces
 * were missing for the same reason. A list of carrier characters is a list
 * that will be wrong again; skipping the run is not.
 *
 * The formula character must still be the first thing that is not a carrier,
 * so a name is only prefixed when it would actually be evaluated. `Docs Best`
 * and ` Sunny` are untouched.
 */
// `no-control-regex` is disabled deliberately. The rule exists to catch a
// control character that arrived in a pattern by accident; here the control
// characters ARE the finding — they are what carries a formula past a check
// that only looks at position zero.
// eslint-disable-next-line no-control-regex
const FORMULA_LEAD = /^[\s\u0000-\u001f]*[=+\-@]/;

/**
 * Escape one CSV field.
 *
 * Quotes everything rather than deciding per value. A horse called
 * `Docs Best, Jr.` and a blocker list containing commas both round-trip, and
 * the rule is one line instead of a set of cases to get wrong.
 *
 * Text that would otherwise be read as a formula is prefixed with an
 * apostrophe, which spreadsheets consume as "treat the rest as text". These
 * files are meant to be handed to a banker or an accountant and opened in
 * Excel, so a horse name imported as `=HYPERLINK(...)` would execute on their
 * machine, not on the ranch's.
 *
 * Numbers are never prefixed. They are passed as numbers by every caller here,
 * so gating on the type keeps `-500` a negative number instead of turning it
 * into the text `'-500` and breaking every sum in the sheet.
 */
export function csvField(value: string | number): string {
  if (typeof value === 'number') return `"${value}"`;
  const text = String(value);
  const guarded = FORMULA_LEAD.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function csvRow(cells: (string | number)[]): string {
  return cells.map(csvField).join(',');
}
