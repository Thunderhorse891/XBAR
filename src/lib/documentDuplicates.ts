import type { DocumentRecord } from '../types/xbar.js';
import { sha256Bytes } from './sha256.js';

export async function fingerprintDocument(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return sha256Bytes(bytes);
}

const normalize = (value: string | undefined) => (value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const validHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** Byte equality is evidence; matching text/name is only a prompt to compare. */
export function assessDocumentDuplicate(document: DocumentRecord, existing: DocumentRecord[]) {
  const active = existing.filter((other) => other.id !== document.id && other.state !== 'Archived');
  const exact = validHash(document.contentSha256)
    ? active.find((other) => validHash(other.contentSha256) && other.contentSha256 === document.contentSha256)
    : undefined;
  if (exact)
    return {
      kind: 'exact' as const,
      documentId: exact.id,
      title: exact.title,
      reason: 'Identical file bytes (SHA-256)',
    };
  const text = normalize(document.extractedTextPreview);
  const related = active.find((other) => {
    if (text.length >= 100 && text === normalize(other.extractedTextPreview)) return true;
    // A repeated filename is not proof that the files are identical. A newer
    // Coggins or revised agreement often has the same name.
    return normalize(document.title) !== '' && normalize(document.title) === normalize(other.title);
  });
  return related
    ? {
        kind: 'possible' as const,
        documentId: related.id,
        title: related.title,
        reason:
          text.length >= 100 && text === normalize(related.extractedTextPreview)
            ? 'Matching extracted text; compare originals'
            : 'Same filename; contents may differ',
      }
    : undefined;
}

/** Input order is stable, even when OCR completed out of order. Keep every file. */
export function flagDocumentDuplicates(incoming: DocumentRecord[], existing: DocumentRecord[]): DocumentRecord[] {
  const accepted: DocumentRecord[] = [];
  for (const document of incoming) {
    const duplicate = assessDocumentDuplicate(document, [...existing, ...accepted]);
    accepted.push(
      duplicate
        ? {
            ...document,
            duplicateRisk: 'Possible Duplicate',
            duplicateOfId: duplicate.documentId,
            duplicateReason: `${duplicate.reason}: ${duplicate.title}`,
            duplicateReviewedAt: undefined,
            state: 'Needs Review',
          }
        : document,
    );
  }
  return accepted;
}

export function documentDuplicateNeedsReview(document: DocumentRecord): boolean {
  return document.duplicateRisk === 'Possible Duplicate' && !document.duplicateReviewedAt;
}
