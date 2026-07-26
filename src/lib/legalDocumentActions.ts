// Browser-side actions for the legal document library.
//
// These live apart from legalDocuments.ts on purpose: scripts/build-marketing.mjs
// imports that module directly under Node to render /privacy and /terms, so it
// has to stay free of anything that reaches for the DOM or for a Capacitor
// plugin. The document data and the HTML renderer are shared; only these two
// actions are app-only.

import { deliverFile } from './fileDelivery.js';
import { legalDocumentToHtml, type LegalDocument } from './legalDocuments.js';

/**
 * Open a print-ready copy in a new window. Returns false when the browser
 * blocks the popup — and always in the native shell, where WKWebView refuses
 * to create a blank window. The in-app reader at /legal/:documentId is the
 * path that works everywhere.
 */
export function openPrintableLegalDocument(legalDoc: LegalDocument) {
  const preview = window.open('', '_blank', 'noopener,noreferrer');
  if (!preview) return false;
  preview.document.write(legalDocumentToHtml(legalDoc));
  preview.document.close();
  preview.focus();
  return true;
}

/** Download (web) or share (native) the document as a print-ready HTML file. */
export function downloadLegalHtml(legalDoc: LegalDocument) {
  return deliverFile({
    fileName: legalDoc.suggestedFileName,
    contents: legalDocumentToHtml(legalDoc),
    mimeType: 'text/html;charset=utf-8',
    shareTitle: legalDoc.shortTitle,
  });
}
