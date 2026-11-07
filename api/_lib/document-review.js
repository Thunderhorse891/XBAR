// The shared server review gate for document facts and packet attachments.
// Legacy rows may omit mirror identity; contradictory supplied mirrors cannot
// make another source belong to this reviewed row.
export function reviewedDocument(doc) {
  const source = doc.payload || {};
  return (
    doc.state === 'Ready' &&
    (!source.state || source.state === 'Ready') &&
    (source.id === undefined || source.id === doc.document_id) &&
    (source.horseId === undefined || source.horseId === doc.horse_id) &&
    (source.type === undefined || source.type === doc.document_type) &&
    !doc.needs_review &&
    !source.identityReviewRequired &&
    !(typeof source.processingNote === 'string' && source.processingNote.trim()) &&
    !(
      (doc.duplicate_risk === 'Possible Duplicate' || source.duplicateRisk === 'Possible Duplicate') &&
      !(typeof source.duplicateReviewedAt === 'string' && source.duplicateReviewedAt.trim())
    )
  );
}
