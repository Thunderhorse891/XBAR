/*
 * Types for the shared PDF layout engine.
 *
 * api/_lib/pdf.js renders every document the product produces. It depends on
 * pdf-lib and nothing else — no filesystem, no Node built-ins — so the browser
 * can call it directly, and the ranch report does.
 *
 * Sharing the renderer rather than porting it is deliberate. A second layout
 * engine on the client would drift from this one silently: a spacing fix or a
 * page-break fix would land in one and not the other, and the export a rancher
 * hands to their banker would stop looking like the documents they already
 * send. The file stays plain JS because Vercel's zero-config API build compiles
 * `api/*.js` as-is, so these declarations are what give the TypeScript side of
 * the app real types over it.
 */
declare module '*/api/_lib/pdf.js' {
  export interface PdfSection {
    heading: string;
    lines: string[];
  }

  export function createSectionedPdf(input: {
    title: string;
    sections: PdfSection[];
    footer?: string;
    letterhead?: string;
    reference?: string;
  }): Promise<Uint8Array>;

  export function asField(part: string): { label: string; value: string } | null;
  export function fieldsInLine(line: string): { label: string; value: string }[] | null;
  export function wrapLine(text: string, font: unknown, size: number, maxWidth: number): string[];
}
