import type { CostPerHorseSummary } from './costPerHorse.js';
import { localIsoDate } from './format.js';
import { saveTextAsFile, type FileSaveResult } from './fileDownload.js';
import { csvRow } from './csv.js';

/*
 * Getting the per-horse cost figures off the screen.
 *
 * The flagship number on the Costs screen — what each horse costs per day —
 * is the figure a rancher hands to a partner, an accountant, or a buyer
 * asking what a horse costs to keep. A dashboard that cannot leave the app is
 * decoration, so this produces a CSV from the same summary the screen
 * renders: per-horse daily cost, the category split, and supplier price rises.
 *
 * The CSV field rules mirror src/lib/ranchReportExport.ts (quoted fields,
 * BOM on download, formula-injection guard) so both exports open identically
 * in Excel. Both import the field escaping from src/lib/csv.ts — one copy,
 * so a hardening change cannot leave one exporter vulnerable.
 */

/** Money to two decimals: a raw float like 10.0000000001 breaks sums and trust alike. */
function money(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The Costs screen as rows. All figures are dollars — the summary keeps money
 * in dollars, the screen just formats the per-day figures with cents
 * precision.
 */
export function costPerHorseToCsv(summary: CostPerHorseSummary): string {
  const lines: string[] = [];

  lines.push(csvRow(['XBAR Cost Per Horse']));
  lines.push(csvRow(['Generated', localIsoDate()]));
  lines.push('');

  lines.push(csvRow(['Summary']));
  lines.push(csvRow(['Horses in care', summary.horsesInCare]));
  lines.push(csvRow(['Days of receipts', summary.trackedDays]));
  // The per-horse daily figures use a different denominator (perHorseDays)
  // when older receipts belong to sold horses — print it beside them, the
  // way the Costs screen does, or the export cannot be reconciled.
  lines.push(csvRow(['Days used for per-horse figures', summary.perHorseDays]));
  lines.push(csvRow(['Cost per horse per day', summary.perHorsePerDay === null ? '—' : money(summary.perHorsePerDay)]));
  // Monthly burn is computed from windowTotal — every receipt in the window,
  // including ones tagged to sold or deleted horses that the horse and
  // category rows intentionally exclude. Print the total beside it, the way
  // the Costs screen does, or an accountant cannot reproduce the burn
  // figure from anything else in the file.
  lines.push(csvRow(['Receipts in window (total)', money(summary.windowTotal)]));
  lines.push(csvRow(['Monthly burn', money(summary.monthlyBurn)]));
  lines.push('');

  lines.push(csvRow(['Cost per horse per day']));
  lines.push(csvRow(['Horse', 'Tagged to horse ($)', 'Ranch-wide share ($)', 'Per day ($)']));
  for (const horse of summary.horses) {
    lines.push(csvRow([horse.horseName, money(horse.direct), money(horse.sharedShare), money(horse.perDay)]));
  }
  lines.push('');

  lines.push(csvRow(["Where each day's cost goes"]));
  lines.push(csvRow(['Category', 'Total ($)', 'Per horse per day ($)', 'Share (%)']));
  for (const group of summary.groups) {
    lines.push(
      csvRow([
        group.group,
        money(group.total),
        group.perHorsePerDay === null ? '—' : money(group.perHorsePerDay),
        Math.round(group.share * 1000) / 10,
      ]),
    );
  }

  if (summary.priceRises.length) {
    lines.push('');
    lines.push(csvRow(['Supplier price rises']));
    lines.push(
      csvRow(['Supplier', 'Product', 'Rise (%)', 'Was ($/unit)', 'Now ($/unit)', 'Extra cost since rise ($)']),
    );
    for (const rise of summary.priceRises) {
      lines.push(
        csvRow([
          rise.vendor,
          rise.product || rise.category,
          rise.risePercent,
          money(rise.baselineUnitPrice),
          money(rise.latestUnitPrice),
          money(rise.extraCost),
        ]),
      );
    }
  }

  return lines.join('\n');
}

export function costPerHorseFileName(generatedOn: string = localIsoDate()): string {
  return `xbar-cost-per-horse-${generatedOn}.csv`;
}

export function downloadCostPerHorseCsv(summary: CostPerHorseSummary): Promise<FileSaveResult> {
  // The BOM is what makes Excel read this as UTF-8 — same reason as the ranch
  // report export.
  return saveTextAsFile(costPerHorseFileName(), '﻿' + costPerHorseToCsv(summary), 'text/csv;charset=utf-8');
}
