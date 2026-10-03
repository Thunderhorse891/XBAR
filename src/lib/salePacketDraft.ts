export type SalePacketDraft = {
  horseId: string;
  step: number;
  selectedDocIds: string[] | null;
  buyerName: string;
  buyerEmail: string;
  watermark: string;
};

// Repair navigation unmounts the wizard. Keep one draft in this page's memory,
// scoped to the signed-in account AND workspace; no buyer details enter a URL,
// browser storage, cloud backup or another workspace. Refresh intentionally
// clears it. Disclosures are re-acknowledged against the current horse record.
let savedDraft: { scope: string; draft: SalePacketDraft } | undefined;

export function savePacketDraft(scope: string, draft: SalePacketDraft) {
  savedDraft = { scope, draft: { ...draft, selectedDocIds: draft.selectedDocIds ? [...draft.selectedDocIds] : null } };
}

export function readPacketDraft(scope: string, horseId: string): SalePacketDraft | undefined {
  return savedDraft?.scope === scope && savedDraft.draft.horseId === horseId ? savedDraft.draft : undefined;
}

export function clearPacketDraft(scope: string, horseId: string) {
  if (readPacketDraft(scope, horseId)) savedDraft = undefined;
}
