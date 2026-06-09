import { create } from 'zustand';
import type { OcrResult } from '@/lib/types';

export type OcrPhase = 'idle' | 'uploading' | 'reading' | 'profiling' | 'review' | 'saving' | 'done';

export interface OcrDraft extends OcrResult {
  // Editable review state layered over the raw OCR result.
  editedHorseName: string;
  assignTo: 'create' | string; // 'create' or an existing horse id
}

interface OcrState {
  phase: OcrPhase;
  progress: number; // 0-100
  statusText: string;
  fileCount: number;
  drafts: OcrDraft[];
  errors: string[];
  begin: (fileCount: number) => void;
  setStage: (phase: OcrPhase, progress: number, statusText: string) => void;
  setResults: (results: OcrResult[]) => void;
  updateDraft: (documentId: string, patch: Partial<Pick<OcrDraft, 'editedHorseName' | 'assignTo'>>) => void;
  setErrors: (errors: string[]) => void;
  reset: () => void;
}

export const useOcrStore = create<OcrState>((set) => ({
  phase: 'idle',
  progress: 0,
  statusText: '',
  fileCount: 0,
  drafts: [],
  errors: [],
  begin: (fileCount) => set({ phase: 'uploading', progress: 5, statusText: 'Uploading files…', fileCount, drafts: [], errors: [] }),
  setStage: (phase, progress, statusText) => set({ phase, progress, statusText }),
  setResults: (results) =>
    set({
      phase: 'review',
      progress: 100,
      statusText: 'Extraction complete. Review before saving.',
      drafts: results.map((result) => ({
        ...result,
        editedHorseName: result.suggestedHorseName || result.extracted[0]?.value || '',
        assignTo: result.suggestedHorseId ?? 'create',
      })),
    }),
  updateDraft: (documentId, patch) =>
    set((state) => ({
      drafts: state.drafts.map((draft) => (draft.documentId === documentId ? { ...draft, ...patch } : draft)),
    })),
  setErrors: (errors) => set({ errors }),
  reset: () => set({ phase: 'idle', progress: 0, statusText: '', fileCount: 0, drafts: [], errors: [] }),
}));
