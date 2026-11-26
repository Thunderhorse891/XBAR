import type { DocumentEntities, DocumentRecord } from '@/types/xbar';

const fieldLabels: [keyof DocumentEntities, string][] = [
  ['horseName', 'Horse name'],
  ['registrationNumber', 'Registration number'],
  ['registry', 'Registry'],
  ['sex', 'Sex'],
  ['color', 'Color'],
  ['breed', 'Breed'],
  ['foaledOn', 'Foaled on'],
  ['sire', 'Sire'],
  ['sireRegistration', 'Sire registration'],
  ['dam', 'Dam'],
  ['damRegistration', 'Dam registration'],
  ['ownerName', 'Owner'],
  ['examDate', 'Exam date'],
  ['veterinarian', 'Veterinarian'],
  ['transferStatus', 'Transfer status'],
];

/** The review queue passes its fresh source projection, never horse-profile defaults. */
export function DocumentExtractionPreview({ document }: { document: DocumentRecord }) {
  const fields = fieldLabels.filter(([key]) => document.entities[key]?.trim());
  return (
    <details>
      <summary>Review extracted details ({fields.length})</summary>
      <div className="table-cell__stack" style={{ overflowWrap: 'anywhere' }}>
        <span>Compare these details with the original before approving. Opening this preview changes no records.</span>
        {fields.length ? (
          fields.map(([key, label]) => (
            <span key={key}>
              <strong>{label}:</strong> {document.entities[key]}
            </span>
          ))
        ) : (
          <span>No structured details could be read. Open the original to review the source.</span>
        )}
        <strong>Text preview</strong>
        {document.extractedTextPreview?.trim() ? (
          <div
            role="region"
            aria-label={`Extracted text preview for ${document.title}`}
            tabIndex={0}
            style={{ maxHeight: '12rem', overflowY: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
          >
            {document.extractedTextPreview}
          </div>
        ) : (
          <span>No text preview is available. Review the original document before approving.</span>
        )}
        <span>
          This preview may not contain the whole document. Use Open file to check the original when available.
        </span>
      </div>
    </details>
  );
}
