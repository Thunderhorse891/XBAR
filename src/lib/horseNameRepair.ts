/*
 * Repair horses that were named by their registration number.
 *
 * Profile creation used to fall back to the registration number when a paper's
 * OCR text carried no labelled name, so a bulk intake produced a roster of
 * horses called 35012691962, 539882319930, 52793571973. That fallback is gone
 * (see horseNameFromDocument.ts), but the records it already created are still
 * named by numbers, and the papers that name them are still attached.
 *
 * This proposes the repair. It does not perform it: every rename is shown to a
 * person first, because renaming a horse rewrites the label on ownership
 * records, documents and sale material, and a wrong bulk rename is far more
 * work to undo than the original defect was.
 */
import { horseNameFromDocumentTitle } from './horseNameFromDocument.js';

export interface RepairableHorse {
  id: string;
  name: string;
  barnName: string;
  registrationNumber: string;
  aqhaNumber?: string;
  documents: readonly string[];
}

export interface RepairSourceDocument {
  id: string;
  title: string;
  horseId?: string;
}

export interface HorseNameRepair {
  horseId: string;
  currentName: string;
  proposedName: string;
  /** Set only when the barn name is ALSO a number and should follow the rename. */
  proposedBarnName?: string;
  sourceDocumentId: string;
  sourceDocumentTitle: string;
  /**
   * Another horse already carrying the proposed name. Present so the review
   * screen can warn; it does not by itself block the repair, because two papers
   * for one horse legitimately produce this.
   */
  collidesWithHorseId?: string;
}

function normalize(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** A value holding no letters at all — a registration number, not a name. */
function holdsNoName(value: string) {
  return !/[A-Za-z]/.test(value);
}

/**
 * Whether this horse's name is a registration number rather than a name.
 *
 * Deliberately narrow. It fires when the name contains no letters at all, or
 * when it is character-for-character the horse's own registration number. A
 * horse with a real name is never a candidate, however odd that name looks.
 */
export function nameNeedsRepair(horse: Pick<RepairableHorse, 'name' | 'registrationNumber' | 'aqhaNumber'>): boolean {
  const name = horse.name.trim();
  if (!name) return false;
  if (holdsNoName(name)) return true;

  const identifiers = [horse.registrationNumber, horse.aqhaNumber]
    .map((value) => normalize(value ?? ''))
    .filter(Boolean);
  return identifiers.includes(normalize(name));
}

/**
 * One proposed rename per horse whose name is a registration number and whose
 * attached papers carry a usable name.
 *
 * A horse with no usable source is omitted entirely rather than proposed with a
 * placeholder: there is nothing to offer, and saying so by absence is honest.
 */
export function proposeHorseNameRepairs(params: {
  horses: readonly RepairableHorse[];
  documents: readonly RepairSourceDocument[];
}): HorseNameRepair[] {
  const { horses, documents } = params;

  // Names already in use, so a proposal can say when it would collide. Built
  // from the CURRENT roster, before any repair is applied.
  const nameOwners = new Map<string, string>();
  horses.forEach((horse) => {
    const key = normalize(horse.name);
    if (key && !nameOwners.has(key)) nameOwners.set(key, horse.id);
  });

  const repairs: HorseNameRepair[] = [];

  horses.forEach((horse) => {
    if (!nameNeedsRepair(horse)) return;

    // Both ways a document is attached: listed on the horse, or pointing at it.
    // Horse order first, so the paper the person sees first is the one used.
    const attached = [
      ...horse.documents.map((id) => documents.find((document) => document.id === id)),
      ...documents.filter((document) => document.horseId === horse.id),
    ].filter((document): document is RepairSourceDocument => Boolean(document));

    const seen = new Set<string>();
    for (const document of attached) {
      if (seen.has(document.id)) continue;
      seen.add(document.id);

      const proposedName = horseNameFromDocumentTitle(document.title);
      if (!proposedName) continue;
      // A rename to the name it already has is not a repair.
      if (normalize(proposedName) === normalize(horse.name)) continue;

      const collidesWithHorseId = nameOwners.get(normalize(proposedName));
      repairs.push({
        horseId: horse.id,
        currentName: horse.name,
        proposedName,
        // The barn name follows only when it is also a number. A barn name a
        // person chose is theirs, and this does not touch it.
        proposedBarnName: nameNeedsRepair({
          name: horse.barnName,
          registrationNumber: horse.registrationNumber,
          aqhaNumber: horse.aqhaNumber,
        })
          ? proposedName.split(/\s+/).slice(0, 2).join(' ')
          : undefined,
        sourceDocumentId: document.id,
        sourceDocumentTitle: document.title,
        collidesWithHorseId: collidesWithHorseId === horse.id ? undefined : collidesWithHorseId,
      });
      return;
    }
  });

  return repairs;
}
