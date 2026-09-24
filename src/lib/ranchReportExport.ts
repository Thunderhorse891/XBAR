import type { RanchReport } from './ranchReport.js';
import { saveBlobAsFile, saveTextAsFile, type FileSaveResult } from './fileDownload.js';

/*
 * Getting the report off the screen.
 *
 * A report a rancher cannot hand to their banker, their accountant, or a
 * partner is a dashboard, not a report — so this produces two artifacts from
 * the same model: a CSV for anyone who wants to do their own arithmetic, and a
 * PDF organized as an executive dashboard and financial registers.
 *
 * Both render entirely in the browser from data already in the store. There is
 * no upload of report data and no paid service to configure: a workspace with no
 * Supabase and no Stripe exports exactly the same file as one with both. That
 * is deliberate — an export that needed credentials would be one more thing to
 * fail, on the screen whose whole job is to be handed to someone else.
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
 * apostrophe, which spreadsheets consume as "treat the rest as text". This
 * file is meant to be handed to a banker or an accountant and opened in Excel,
 * so a horse name imported as `=HYPERLINK(...)` would execute on their machine,
 * not on the ranch's.
 *
 * Numbers are never prefixed. They are passed as numbers by every caller here,
 * so gating on the type keeps `-500` a negative number instead of turning it
 * into the text `'-500` and breaking every sum in the sheet.
 */
function csvField(value: string | number): string {
  if (typeof value === 'number') return `"${value}"`;
  const text = String(value);
  const guarded = FORMULA_LEAD.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function csvRow(cells: (string | number)[]): string {
  return cells.map(csvField).join(',');
}

export function ranchReportToCsv(report: RanchReport, ranchName = ''): string {
  const lines: string[] = [];

  // The first lines identify the operation and disclaim the figures: an
  // accountant opens this in Excel, and the old header identified nobody and
  // carried none of the unaudited-estimates note the PDF prints.
  const operationName = ranchName.trim() || 'Your ranch name';
  lines.push(csvRow([`${operationName} — ranch report`]));
  lines.push(csvRow(['Generated', report.generatedOn]));
  lines.push(csvRow(['Data source', 'Ranch records']));
  lines.push(csvRow(['Rounding', 'Figures keep cents here; the PDF report rounds money to whole dollars.']));
  lines.push(csvRow(['Note', 'Unaudited management estimates based on recorded data. Not an appraisal or an audit.']));
  lines.push('');

  lines.push(csvRow(['Summary']));
  lines.push(csvRow(['Horses', report.horseCount]));
  lines.push(csvRow(['Listed for sale', report.listedCount]));
  lines.push(csvRow(['Invested to date', report.money.investedToDate]));
  lines.push(csvRow(['Of that, purchase prices', report.money.acquisitionCost]));
  lines.push(csvRow(['Of that, recorded spend', report.money.receiptSpend]));
  lines.push(csvRow(['Invested in horses', report.money.investedInHorses]));
  lines.push(csvRow(['Invested this month', report.money.investedThisMonth]));
  lines.push(csvRow(['Unallocated overhead this month', report.money.unallocatedThisMonth]));
  lines.push(csvRow(['Monthly burn (3-month average)', report.money.monthlyBurn]));
  lines.push(csvRow(['Listed value', report.money.listedValue]));
  lines.push(csvRow(['Value at risk', report.money.valueAtRisk]));
  lines.push(csvRow(['Ready to close', report.money.readyValue]));
  lines.push(csvRow(['Open offers', report.money.pipelineValue]));
  lines.push(csvRow(['Deposits held', report.money.depositsHeld]));
  lines.push(csvRow(['Documents to review', report.documentsToReview]));
  lines.push('');

  lines.push(csvRow(['Horse economics']));
  lines.push(
    csvRow([
      'Horse',
      'Status',
      'Invested to date',
      'Monthly burn',
      'Asking price',
      'Break-even',
      'Projected margin',
      'Margin %',
      'Floor',
      'Readiness %',
      'Blockers',
    ]),
  );
  for (const horse of report.horses) {
    lines.push(
      csvRow([
        horse.horseName,
        horse.status,
        horse.investedToDate,
        horse.monthlyBurn,
        horse.askPrice,
        horse.breakEvenPrice,
        horse.projectedMargin,
        horse.marginPercent,
        horse.safeDiscountFloor,
        horse.readinessScore,
        horse.blockers.join('; '),
      ]),
    );
  }
  lines.push('');

  lines.push(csvRow(['Spend by category']));
  lines.push(csvRow(['Category', 'Total', 'Share %', 'This month']));
  for (const category of report.categories) {
    lines.push(csvRow([category.category, category.total, category.share, category.thisMonth]));
  }

  if (report.anomalies.length) {
    lines.push('');
    lines.push(csvRow(['Spend running above trend']));
    lines.push(csvRow(['Category', 'This month', '3-month average', 'Change %']));
    for (const anomaly of report.anomalies) {
      lines.push(csvRow([anomaly.category, anomaly.monthTotal, anomaly.trailingAverage, anomaly.deltaPercent]));
    }
  }

  return lines.join('\n');
}

/**
 * `xbar-ranch-report-2026-08-21.csv` — sorts chronologically in a folder.
 *
 * The local calendar date, not `generatedAt.slice(0, 10)`. That slice is the
 * UTC day, so a report exported on a US evening arrived in the rancher's
 * downloads folder dated tomorrow — and sorted ahead of one they would run in
 * the morning.
 */
export function ranchReportFileName(report: RanchReport, extension: string): string {
  return `xbar-ranch-report-${report.generatedOn}.${extension}`;
}

export function downloadRanchReportCsv(report: RanchReport, ranchName = ''): Promise<FileSaveResult> {
  // The BOM is what makes Excel read this as UTF-8. Without it a horse name
  // with an accent arrives mangled in the one program most of these files will
  // be opened in.
  return saveTextAsFile(
    ranchReportFileName(report, 'csv'),
    '﻿' + ranchReportToCsv(report, ranchName),
    'text/csv;charset=utf-8',
  );
}

/**
 * Render and download the report as a PDF.
 *
 * pdf-lib is imported lazily so its ~400KB does not land in the initial bundle
 * for every visitor — the Reports screen is not the first thing anyone opens,
 * and most sessions never export.
 */
export async function downloadRanchReportPdf(report: RanchReport, ranchName: string): Promise<FileSaveResult> {
  const { renderReportPdf } = await import('./ranchReportPdf.js');
  const bytes = await renderReportPdf(report, ranchName);
  return saveBlobAsFile(ranchReportFileName(report, 'pdf'), new Blob([bytes as BlobPart], { type: 'application/pdf' }));
}
