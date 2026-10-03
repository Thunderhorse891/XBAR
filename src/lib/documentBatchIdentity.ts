import type { DocumentRecord } from '../types/xbar.js';
import { normalizeDocumentIdentityText } from './registrationExtraction.js';
import { conflictingDocumentIdentities, registrationKey } from './xbarRuntime.js';

const profileFields = [
  ['horseName', 'horse name'],
  ['registrationNumber', 'registration number'],
  ['registry', 'registry'],
  ['sex', 'sex'],
  ['color', 'color'],
  ['breed', 'breed'],
  ['foaledOn', 'foaling date'],
  ['sire', 'sire'],
  ['sireRegistration', 'sire registration'],
  ['dam', 'dam'],
  ['damRegistration', 'dam registration'],
  ['ownerName', 'recorded owner'],
] as const;

export type DocumentBatchGroup = { documents: DocumentRecord[]; conflictFields: string[]; reviewReason?: string };

/** Group related sources, not files. Shared identity links a candidate; it does
 * not authorize creating it. Conflicting connected sources remain together for
 * review rather than splitting into plausible-looking duplicate horse records.
 */
export function groupDocumentBatchCandidates(documents: DocumentRecord[]): DocumentBatchGroup[] {
  const parents = documents.map((_, index) => index);
  const root = (index: number): number => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const keys = new Map<string, number>();
  documents.forEach((document, index) => {
    const name = normalizeDocumentIdentityText(document.entities.horseName ?? '');
    const registration = registrationKey(document.entities.registrationNumber);
    for (const key of [name ? `name:${name}` : '', registration ? `registration:${registration}` : '']) {
      if (!key) continue;
      const other = keys.get(key);
      if (other !== undefined) parents[root(index)] = root(other);
      else keys.set(key, index);
    }
  });
  const groups = new Map<number, DocumentRecord[]>();
  documents.forEach((document, index) => {
    const group = root(index);
    groups.set(group, [...(groups.get(group) ?? []), document]);
  });
  return [...groups.values()].map((group) => {
    const conflictFields: string[] = profileFields.flatMap(([key, label]) => {
      const values = new Set(
        group
          .map((document) => document.entities[key])
          .filter((value): value is string => Boolean(value?.trim()))
          .map((value) =>
            key.toLowerCase().includes('registration') ? registrationKey(value) : normalizeDocumentIdentityText(value),
          ),
      );
      return values.size > 1 ? [label] : [];
    });
    // Registry prefixes also carry identity when an older payload has no
    // separate registry field. Use the same conflict rule as existing intake.
    if (conflictingDocumentIdentities(group.map((document) => document.entities)) && !conflictFields.length)
      conflictFields.push('horse identity');
    const reviewReason = conflictFields.length
      ? `Files in this batch disagree on ${conflictFields.join(', ')}. Compare the originals and choose the correct horse before approving.`
      : !group.some((document) => document.entities.horseName?.trim())
        ? 'No horse name was read from these sources. Review the originals before creating a horse; the filename is not identity evidence.'
        : group.length > 1 && !group.some((document) => registrationKey(document.entities.registrationNumber))
          ? 'These files share a horse name without a registration number. Compare the originals before creating or assigning a horse.'
          : undefined;
    return { documents: group, conflictFields, reviewReason };
  });
}
