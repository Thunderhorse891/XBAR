import { PDFDocument, StandardFonts, rgb, type PDFPage, type RGB } from 'pdf-lib';
import { toDrawableText } from '../../api/_lib/pdf.js';
import type { RanchReport } from './ranchReport.js';
import { reportDecisions, reportDollars as dollars, reportException } from './ranchReportDecisions.js';

type ReportBranding = { logo: Uint8Array; mark: Uint8Array; watermark: Uint8Array };
async function loadReportBranding(): Promise<ReportBranding> {
  const load = async (path: string) => {
    const response = await fetch(path);
    if (!response.ok) throw new Error('Report branding could not be loaded. Please try again.');
    return new Uint8Array(await response.arrayBuffer());
  };
  const [logo, mark, watermark] = await Promise.all([
    load('/brand/xbar-report-horse.png'),
    load('/brand/xbar-report-mark.png'),
    load('/brand/xbar-report-watermark.png'),
  ]);
  return { logo, mark, watermark };
}

/** Decision-oriented US Letter report, with vector charts and searchable tables. */
export async function renderReportPdf(
  report: RanchReport,
  ranchName: string,
  branding?: ReportBranding,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const assets = branding ?? (await loadReportBranding());
  const logo = await pdf.embedPng(assets.logo);
  const mark = await pdf.embedPng(assets.mark);
  const watermark = await pdf.embedPng(assets.watermark);
  const ink = rgb(0.08, 0.15, 0.23),
    muted = rgb(0.32, 0.39, 0.46),
    blue = rgb(0.12, 0.37, 0.58);
  const red = rgb(0.64, 0.18, 0.16),
    green = rgb(0.1, 0.4, 0.32),
    amber = rgb(0.55, 0.34, 0.08);
  const pale = rgb(0.95, 0.97, 0.98),
    line = rgb(0.84, 0.88, 0.91),
    white = rgb(1, 1, 1);
  const decision = reportDecisions(report),
    money = report.money;
  let page: PDFPage;
  const clean = (s: string) => toDrawableText(s).replace(/[–—]/g, '-');
  const measure = (s: string, size: number, strong = false) =>
    (strong ? bold : regular).widthOfTextAtSize(clean(s), size);
  function text(s: string, x: number, top: number, size = 9, color = ink, strong = false) {
    page.drawText(clean(s), { x, y: 792 - top - size, size, font: strong ? bold : regular, color });
  }
  function rect(x: number, top: number, width: number, height: number, color = pale) {
    page.drawRectangle({ x, y: 792 - top - height, width, height, color });
  }
  function wrap(s: string, width: number, size = 9, strong = false): string[] {
    const lines: string[] = [];
    let current = '';
    for (const word of clean(s).split(/\s+/)) {
      if (current && measure(`${current}${word}`, size, strong) > width) {
        lines.push(current);
        current = '';
      }
      for (const char of word) {
        if (measure(current + char, size, strong) > width) {
          lines.push(current);
          current = '';
        }
        current += char;
      }
      current += ' ';
    }
    if (current.trim()) lines.push(current.trim());
    return lines.length ? lines.map((s) => s.trim()) : [''];
  }
  function paragraph(s: string, x: number, top: number, width: number, size = 9, color = muted, strong = false) {
    const lines = wrap(s, width, size, strong);
    lines.forEach((s, i) => text(s, x, top + i * (size + 3), size, color, strong));
    return lines.length * (size + 3);
  }
  function newPage(title: string, subtitle: string) {
    page = pdf.addPage([612, 792]);
    rect(0, 0, 612, 5, blue);
    // Branding is confined to the masthead, never behind operational data.
    page.drawImage(watermark, { x: 445, y: 713, width: 130, height: 73, opacity: 0.018 });
    page.drawImage(logo, { x: 36, y: 724, width: 72, height: 40.5 });
    text('XBAR™ / RANCH INTELLIGENCE', 120, 29, 8, blue, true);
    text(title, 120, 43, 21, ink, true);
    const name = clean(ranchName || 'XBAR Ranch Ledger');
    const nameSize = Math.max(7, Math.min(9, (9 * 540) / Math.max(540, measure(name, 9))));
    // The full entity name is retained in PDF metadata; masthead is at most two lines.
    const nameLines = wrap(name, 540, nameSize);
    nameLines
      .slice(0, 2)
      .forEach((s, i) => text(i === 1 && nameLines.length > 2 ? `${s.slice(0, -3)}...` : s, 36, 77 + i * 10, nameSize));
    text(`${report.generatedOn}  /  USD  /  ${subtitle}`, 36, 101, 8, muted);
    rect(36, 115, 540, 1, line);
  }
  function heading(s: string, x: number, y: number) {
    text(s, x, y, 11, ink, true);
  }
  function card(label: string, value: string, note: string, x: number, top: number, width: number, color = ink) {
    rect(x, top, width, 68);
    rect(x, top, 3, 68, color);
    text(label.toUpperCase(), x + 11, top + 9, 7.5, muted, true);
    const size = Math.min(22, (22 * (width - 22)) / Math.max(width - 22, measure(value, 22, true)));
    text(value, x + 11, top + 23, size, color, true);
    text(note, x + 11, top + 52, 7, muted);
  }
  function bar(
    label: string,
    value: number,
    max: number,
    x: number,
    top: number,
    width: number,
    color = blue,
    valueLabel = dollars(value),
  ) {
    const available = width - measure(valueLabel, 8, true) - 10;
    const labelLines = wrap(label, available, 8);
    text(labelLines.length > 1 ? `${labelLines[0]}...` : label, x, top, 8, muted);
    text(valueLabel, x + width - measure(valueLabel, 8, true), top, 8, color, true);
    rect(x, top + 15, width, 7, pale);
    if (value > 0 && max > 0) rect(x, top + 15, width * Math.min(1, value / max), 7, color);
  }

  newPage('Executive dashboard', `${report.horseCount} horses / ${report.listedCount} in sale inventory`);
  const firstCards = [
    ['Invested', dollars(money.investedToDate), 'Acquisition + all receipts', ink],
    ['Listed value', dollars(money.listedValue), 'Asking, not appraisal', blue],
    [
      'Potential margin',
      dollars(decision.potentialMargin),
      'Priced sale horses only',
      decision.potentialMargin < 0 ? red : green,
    ],
    ['Monthly burn', dollars(money.monthlyBurn), 'Prior 3 complete months', ink],
  ] as const;
  firstCards.forEach(([label, value, note, color], i) => card(label, value, note, 36 + i * 138, 130, 126, color));
  card(
    'Sale-ready value',
    dollars(money.readyValue),
    'No recorded sale blockers',
    36,
    209,
    172,
    money.readyValue === 0 && report.listedCount > 0 ? red : green,
  );
  card(
    'Blocked value',
    dollars(money.valueAtRisk),
    `${decision.blocked.length} horses need action`,
    220,
    209,
    172,
    money.valueAtRisk > 0 ? red : ink,
  );
  card('Open offers', dollars(money.pipelineValue), 'Offers may overlap per horse', 404, 209, 172, blue);
  const blockedShare = money.listedValue > 0 ? Math.round((money.valueAtRisk / money.listedValue) * 100) : 0;
  rect(36, 292, 540, 62, decision.blocked.length ? rgb(0.99, 0.94, 0.92) : pale);
  text(
    decision.blocked.length
      ? money.listedValue > 0
        ? `${blockedShare}% OF ASKING VALUE BLOCKED`
        : 'BLOCKED HORSES / ASKING VALUES NOT SET'
      : 'SALE PIPELINE SNAPSHOT',
    49,
    303,
    10,
    decision.blocked.length ? red : green,
    true,
  );
  text(
    `${dollars(money.readyValue)} ready to close today*`,
    49,
    321,
    Math.min(19, (19 * 290) / Math.max(290, measure(`${dollars(money.readyValue)} ready to close today*`, 19, true))),
    money.readyValue === 0 && report.listedCount ? red : ink,
    true,
  );
  text(
    `${decision.blocked.length} blocked / ${decision.listed.length - decision.blocked.length} without recorded blockers`,
    352,
    326,
    8,
    muted,
  );
  heading('Capital vs. asking value', 36, 371);
  const maxCapital = Math.max(money.investedToDate, money.listedValue, 1);
  bar('Invested - whole roster + receipts', money.investedToDate, maxCapital, 36, 394, 252);
  bar('Listed - sale inventory only', money.listedValue, maxCapital, 36, 426, 252, blue);
  heading('Sale pipeline / asking value', 318, 371);
  bar('Blocked', money.valueAtRisk, Math.max(1, money.listedValue), 318, 394, 258, red);
  bar('Sale-ready*', money.readyValue, Math.max(1, money.listedValue), 318, 426, 258, green);
  heading('What matters now', 36, 464);
  paragraph(
    `${dollars(money.valueAtRisk)} of listed asking value is held behind recorded sale requirements. Current-month receipts total ${dollars(money.investedThisMonth)}; ${dollars(money.unallocatedThisMonth)} is unallocated overhead. No prior report snapshot is available, so changes in portfolio value are not asserted.`,
    36,
    484,
    540,
    9,
    ink,
  );
  heading('TOP ACTIONS / FROM WORKSPACE RECORDS', 36, 541);
  let actionY = 563;
  let extendedActions = false;
  for (const [i, action] of decision.actions.slice(0, 3).entries()) {
    rect(36, actionY, 20, 20, blue);
    text(String(i + 1), 42, actionY + 4, 9, white, true);
    const lines = wrap(action, 505, 9);
    extendedActions ||= lines.length > 3;
    const shown = lines.length > 3 ? [...lines.slice(0, 2), 'See action detail for the full recommendation.'] : lines;
    shown.forEach((s, j) => text(s, 67, actionY + j * 12, 9, ink));
    actionY += Math.max(28, shown.length * 12 + 10);
  }
  paragraph(
    '*Sale-ready reflects recorded ownership, reviewed/current Coggins and medical-review gates, not a guaranteed closing. Potential margin = asking less horse break-even; excludes unallocated overhead, fees and taxes. Estimates are based on recorded data, not an appraisal or audit.',
    36,
    Math.max(684, actionY + 7),
    540,
    7.5,
  );

  type Cell = { value: string; color?: RGB; strong?: boolean; badge?: boolean };
  function table(
    headers: string[],
    widths: number[],
    rows: Cell[][],
    start: number,
    bottom: number,
    title: string,
    subtitle: string,
  ) {
    let y = start;
    function tableHeader() {
      rect(36, y, 540, 26, ink);
      let x = 36;
      headers.forEach((s, i) => {
        paragraph(s, x + 5, y + 5, widths[i] - 10, 7.5, white, true);
        x += widths[i];
      });
      y += 26;
    }
    if (y + 50 > bottom) {
      newPage(title, subtitle);
      y = 130;
    }
    tableHeader();
    if (!rows.length) {
      paragraph('No records in this section.', 42, y + 10, 525);
      return y + 38;
    }
    rows.forEach((row, index) => {
      const lines = row.map((cell, i) => wrap(cell.value, widths[i] - 10, 7.5, cell.strong));
      const height = Math.max(20, Math.max(...lines.map((s) => s.length)) * 9 + 4);
      if (height > bottom - 156)
        throw new Error('A report row is too long to fit safely. Shorten the record text and retry.');
      if (y + height > bottom) {
        newPage(title, subtitle);
        y = 130;
        tableHeader();
      }
      rect(36, y, 540, height, index % 2 === 0 ? pale : white);
      let x = 36;
      row.forEach((cell, i) => {
        if (cell.badge)
          rect(
            x + 3,
            y + 2,
            widths[i] - 6,
            height - 4,
            cell.color === red ? rgb(0.99, 0.94, 0.92) : rgb(0.91, 0.96, 0.93),
          );
        const numeric = i > 0 && /^[-$\d]/.test(cell.value) && lines[i].length === 1;
        lines[i].forEach((s, j) =>
          text(
            s,
            numeric ? x + widths[i] - 5 - measure(s, 7.5, cell.strong) : x + 5,
            y + 2 + j * 9,
            7.5,
            cell.color ?? ink,
            cell.strong,
          ),
        );
        x += widths[i];
      });
      rect(36, y + height - 0.5, 540, 0.5, line);
      y += height;
    });
    return y;
  }
  newPage('Sale readiness & blockers', 'Exception management / blocked first, then asking value');
  rect(36, 130, 540, 42, pale);
  text(
    `${decision.blocked.length} horses blocked  /  ${dollars(money.valueAtRisk)} blocked asking value`,
    47,
    138,
    11,
    red,
    true,
  );
  text(
    `${decision.missingOwnership.length} missing ownership records  /  ${decision.missingCoggins.length} missing Coggins  /  ${report.documentsToReview} files awaiting review`,
    47,
    157,
    8,
    muted,
  );
  paragraph(
    `Average profile readiness ${report.readiness.average}% is a stored score, not sale clearance. The remaining ${Math.max(0, 100 - report.readiness.average)} points are not itemized in these records. Sale gates below are assessed separately and can block all listed value regardless of that score.`,
    36,
    184,
    540,
    8,
  );
  rect(36, 215, 540, 5, pale);
  if (decision.listed.length) {
    const blockedWidth = (540 * decision.blocked.length) / decision.listed.length;
    if (blockedWidth) rect(36, 215, blockedWidth, 5, red);
    if (blockedWidth < 540) rect(36 + blockedWidth, 215, 540 - blockedWidth, 5, green);
  }
  const exceptionRows = [...decision.listed]
    .sort((a, b) => Number(b.blockers.length > 0) - Number(a.blockers.length > 0) || b.askPrice - a.askPrice)
    .map((h) => {
      const e = reportException(h);
      return [
        { value: h.horseName, strong: true },
        { value: h.askPrice > 0 ? dollars(h.askPrice) : 'Not set' },
        { value: e.ownership },
        { value: e.coggins },
        { value: e.other },
        {
          value: h.blockers.length ? 'Blocked' : 'Ready*',
          color: h.blockers.length ? red : green,
          strong: true,
          badge: true,
        },
        { value: e.action },
      ];
    });
  let end = table(
    ['Horse', 'Asking price', 'Ownership', 'Coggins', 'Other blockers', 'Readiness', 'Required action'],
    [102, 54, 72, 70, 60, 56, 126],
    exceptionRows,
    226,
    687,
    'Sale readiness & blockers',
    'Exception register / continued',
  );
  paragraph(
    'Missing = no file recorded. Not started = no ownership record. Awaiting review = an existing file in Queued, Matched or Needs Review. Counts overlap across horses; do not add blocked dollars twice. Ready* means no recorded sale blockers, not a guaranteed sale.',
    36,
    end + 12,
    540,
    7.5,
  );
  newPage('Horse-level economics', 'Ranked by projected profit / priced sale inventory first');
  if (decision.listed.some((h) => h.projectedMargin < 0)) {
    text('ACTION / Review negative projected profits before discounting. Resolve blocked sale gates.', 36, 119, 7, red);
  } else if (decision.listed.some((h) => h.projectedMargin > 0)) {
    text(
      'ACTION / Prioritize the highest projected profits below; resolve blocked sale gates before closing.',
      36,
      119,
      7,
      blue,
    );
  }
  const economicRows = decision.ranked.map((h) => {
    const priced = h.saleInventory && h.askPrice > 0;
    const band = h.marginPercent >= 30 ? 'H' : h.marginPercent >= 15 ? 'M' : 'L';
    const color = h.marginPercent >= 30 ? green : h.marginPercent >= 15 ? amber : red;
    return [
      {
        value: `${h.horseName} / ${h.saleInventory ? (h.blockers.length ? 'B' : 'R') : 'N'}`,
        strong: true,
        color: h.saleInventory ? (h.blockers.length ? red : green) : muted,
      },
      { value: dollars(h.investedToDate) },
      { value: dollars(h.monthlyBurn) },
      { value: priced ? dollars(h.askPrice) : h.saleInventory ? 'Not set' : 'N/A' },
      { value: dollars(h.breakEvenPrice) },
      { value: priced ? dollars(h.projectedMargin) : 'N/A', color: priced ? color : muted, strong: true },
      { value: priced ? `${h.marginPercent}% ${band}` : 'N/A', color: priced ? color : muted },
      { value: dollars(h.safeDiscountFloor) },
    ];
  });
  end = table(
    ['Horse / gate', 'Invested', 'Monthly cost', 'Asking', 'Break-even', 'Projected profit', 'Margin %', 'Floor'],
    [116, 59, 51, 56, 60, 65, 55, 78],
    economicRows,
    130,
    540,
    'Horse-level economics',
    'Ranked financial register / continued',
  );
  const analysisY = end + 16;
  heading('Margin distribution / sale horses', 36, analysisY);
  heading('Spending / receipts recorded', 318, analysisY);
  decision.bands.forEach((band, i) =>
    bar(
      band.label,
      band.count,
      Math.max(1, ...decision.bands.map((s) => s.count)),
      36,
      analysisY + 23 + i * 29,
      252,
      [green, amber, red][i],
      `${band.count} horses`,
    ),
  );
  const spendRows = report.categories.slice(0, 3);
  if (!spendRows.length)
    paragraph('No receipts recorded. Zero spend does not establish zero operating costs.', 318, analysisY + 23, 258, 8);
  spendRows.forEach((c, i) =>
    bar(
      c.category,
      Math.max(0, c.total),
      Math.max(1, ...spendRows.map((s) => s.total)),
      318,
      analysisY + 23 + i * 29,
      258,
      blue,
      `${dollars(c.total)} / ${c.share}%`,
    ),
  );
  paragraph(
    `Current month: ${dollars(money.investedThisMonth)} receipts; ${dollars(money.unallocatedThisMonth)} unallocated overhead. Monthly cost/burn averages the prior 3 complete months, excluding this month. $0 means no net recorded spend in that window, not free care.`,
    36,
    analysisY + 113,
    540,
    7.5,
  );
  paragraph(
    'Break-even = investment + 2 months average cost. Profit = asking - break-even; margin = profit / asking. Floor = break-even + 15% (planning rule). Horse figures exclude unallocated overhead. H >=30%, M 15-29%, L <15%. B = blocked, R = no recorded blockers, N = not sale inventory.',
    36,
    analysisY + 148,
    540,
    7.5,
  );

  // Complete detail is retained for large workspaces instead of silently dropping rows.
  if (report.categories.length > 3 || decision.actions.length > 3 || extendedActions || report.anomalies.length) {
    newPage('Action & spending detail', 'Workspace-derived follow-through');
    let y = 130;
    for (const [i, action] of decision.actions.entries()) {
      const height = wrap(action, 510, 9).length * 12 + 12;
      if (y + height > 700) {
        newPage('Action detail', 'Continued');
        y = 130;
      }
      y += paragraph(`${i + 1}. ${action}`, 36, y, 540, 9, ink) + 12;
    }
    const extraRows =
      report.categories.length > 3
        ? report.categories.map((c) => [
            { value: c.category },
            { value: dollars(c.total) },
            { value: `${c.share}%` },
            { value: dollars(c.thisMonth) },
          ])
        : [];
    if (extraRows.length)
      y = table(
        ['Category', 'All receipts', 'Share', 'Current month'],
        [210, 120, 90, 120],
        extraRows,
        y + 12,
        710,
        'Spending detail',
        'All categories / continued',
      );
    for (const anomaly of report.anomalies) {
      const message = `${anomaly.category}: current ${dollars(anomaly.monthTotal)} vs prior monthly average ${dollars(anomaly.trailingAverage)} (+${anomaly.deltaPercent}%). ${anomaly.actionLabel}. Current month is partial.`;
      const height = wrap(message, 540, 9).length * 12 + 20;
      if (y + height > 710) {
        newPage('Spending signals', 'Recorded current month vs prior complete months');
        y = 130;
      }
      y += paragraph(message, 36, y + 12, 540, 9) + 20;
    }
  }
  pdf.getPages().forEach((p, index) => {
    page = p;
    rect(36, 746, 540, 0.5, line);
    page.drawImage(mark, { x: 36, y: 29, width: 12, height: 12 });
    text('XBAR™ / Workspace records / Unaudited management estimates', 55, 754, 7, muted);
    text(`${index + 1} / ${pdf.getPageCount()}`, 550, 754, 7, muted);
  });
  pdf.setTitle(`${ranchName || 'XBAR'} - Ranch management report`);
  pdf.setProducer('XBAR Ranch Ledger');
  return pdf.save();
}
