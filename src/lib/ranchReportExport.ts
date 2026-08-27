import type { RanchReport } from './ranchReport.js';

/*
 * Getting the report off the screen.
 *
 * A report a rancher cannot hand to their banker, their accountant, or a
 * partner is a dashboard, not a report — so this produces two artifacts from
 * the same model: a CSV for anyone who wants to do their own arithmetic, and a
 * PDF laid out like the rest of the product's documents.
 *
 * Both render entirely in the browser from data already in the store. There is
 * no upload, no server call, and nothing to configure: a workspace with no
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

export function ranchReportToCsv(report: RanchReport): string {
  const lines: string[] = [];

  lines.push(csvRow(['XBAR Ranch Report']));
  lines.push(csvRow(['Generated', report.generatedOn]));
  lines.push('');

  lines.push(csvRow(['Summary']));
  lines.push(csvRow(['Horses', report.horseCount]));
  lines.push(csvRow(['Listed for sale', report.listedCount]));
  lines.push(csvRow(['Invested to date', report.money.investedToDate]));
  lines.push(csvRow(['Of that, purchase prices', report.money.acquisitionCost]));
  lines.push(csvRow(['Of that, recorded spend', report.money.receiptSpend]));
  lines.push(csvRow(['Invested in horses', report.money.investedInHorses]));
  lines.push(csvRow(['Invested this month', report.money.investedThisMonth]));
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
      'Do not go below',
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

function money(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

/**
 * The report as document sections, in the shape the PDF layer renders.
 *
 * `Label: value` lines become aligned label/value rows, and a label with an
 * empty value becomes a ruled fill-in line — so a value that is genuinely zero
 * is written as `$0`, never left blank.
 */
export function ranchReportSections(report: RanchReport) {
  const sections: { heading: string; lines: string[] }[] = [];

  sections.push({
    heading: 'Where the money is',
    lines: [
      `Invested to date: ${money(report.money.investedToDate)}`,
      `Of that, purchase prices: ${money(report.money.acquisitionCost)}`,
      `Of that, recorded spend: ${money(report.money.receiptSpend)}`,
      `Tied to specific horses: ${money(report.money.investedInHorses)}`,
      `Spent this month: ${money(report.money.investedThisMonth)}`,
      `Monthly burn (3-month average): ${money(report.money.monthlyBurn)}`,
      `Listed for sale: ${money(report.money.listedValue)}`,
      `Ready to close today: ${money(report.money.readyValue)}`,
      // Any blocker, not only a document one — a medical review or an unmarked
      // transfer lands here too, and this page is read by a lender.
      `Held up by blockers: ${money(report.money.valueAtRisk)}`,
      `Open offers: ${money(report.money.pipelineValue)}`,
      `Deposits held: ${money(report.money.depositsHeld)}`,
    ],
  });

  if (report.risk.items.length) {
    sections.push({
      heading: 'What is holding up a sale',
      lines: report.risk.items.flatMap((item) => [
        `${item.horseName}: ${money(item.askPrice)} — ${item.blockers.join(', ')}`,
      ]),
    });
  }

  if (report.horses.length) {
    sections.push({
      heading: 'Cost and margin by horse',
      // One row per horse, name as the label.
      //
      // These were four indented rows each, which read as one flat list on the
      // page: `fieldsInLine` splits on runs of two or more spaces, so the
      // indent that separated one horse from the next was consumed as a column
      // break and never drawn. A reader could not tell where a horse's figures
      // ended and the next horse's began — on the page whose entire job is to
      // say what each animal costs.
      lines: report.horses.map((horse) => {
        const parts = [horse.status, `invested ${money(horse.investedToDate)}`, `${money(horse.monthlyBurn)}/mo`];
        if (horse.askPrice > 0) {
          parts.push(
            `asking ${money(horse.askPrice)}`,
            `break-even ${money(horse.breakEvenPrice)}`,
            `margin ${money(horse.projectedMargin)} (${horse.marginPercent}%)`,
            `floor ${money(horse.safeDiscountFloor)}`,
          );
        } else {
          // Same distinction the screen makes, from the same predicate. This
          // export is what goes to a banker, so a page saying "not listed for
          // sale" beneath its own listed count is the version that does real
          // damage.
          parts.push(horse.saleInventory ? 'asking price not set' : 'not listed for sale');
        }
        // Single spaces between parts, so the whole summary stays one value and
        // wraps inside the value column instead of being split into columns.
        return `${horse.horseName}: ${parts.join(' \u00b7 ')}`;
      }),
    });
  }

  if (report.categories.length) {
    sections.push({
      heading: 'Spend by category',
      // Percent of recorded spend, not of invested-to-date — acquisitions are
      // not a spend category, so saying "of total" here would not add up.
      lines: report.categories.map(
        (category) => `${category.category}: ${money(category.total)} (${category.share}% of spend)`,
      ),
    });
  }

  if (report.anomalies.length) {
    sections.push({
      heading: 'Running above trend',
      lines: report.anomalies.map(
        (anomaly) =>
          `${anomaly.category}: ${money(anomaly.monthTotal)} this month vs ${money(anomaly.trailingAverage)} average (+${anomaly.deltaPercent}%)`,
      ),
    });
  }

  sections.push({
    heading: 'Sale readiness',
    lines: [
      `Average readiness: ${report.readiness.average}%`,
      `Ready to sell: ${report.readiness.ready}`,
      `Getting there: ${report.readiness.gettingThere}`,
      `Not ready: ${report.readiness.notReady}`,
      `Documents to review: ${report.documentsToReview}`,
    ],
  });

  return sections;
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

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadRanchReportCsv(report: RanchReport): void {
  // The BOM is what makes Excel read this as UTF-8. Without it a horse name
  // with an accent arrives mangled in the one program most of these files will
  // be opened in.
  const blob = new Blob(['﻿', ranchReportToCsv(report)], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, ranchReportFileName(report, 'csv'));
}

/**
 * Render and download the report as a PDF.
 *
 * pdf-lib is imported lazily so its ~400KB does not land in the initial bundle
 * for every visitor — the Reports screen is not the first thing anyone opens,
 * and most sessions never export.
 */
export async function downloadRanchReportPdf(report: RanchReport, ranchName: string): Promise<void> {
  const { renderReportPdf } = await import('./ranchReportPdf.js');
  const bytes = await renderReportPdf(report, ranchName);
  downloadBlob(new Blob([bytes as BlobPart], { type: 'application/pdf' }), ranchReportFileName(report, 'pdf'));
}
