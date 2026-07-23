// Animal Passport identity primitives.
//
// Two deterministic, dependency-free helpers that turn a stored horse record
// into passport-grade identity:
//   1. animalPassportId — a stable, human-readable XBAR ID derived from the
//      record's permanent id. Same id always yields the same code, so it can
//      be printed on a stall card, cited in a sale listing, or scanned later.
//   2. identityCompleteness — an honest count of which core identity fields are
//      on file, so a rancher knows exactly what a buyer-facing passport is
//      still missing. No scores are invented; every field maps to real data.

import type { GalleryAsset, HorseRecord } from '../types/xbar.js';

// Crockford base32 (no I, L, O, U) — unambiguous when written by hand.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// Two distinct FNV-1a offset bases. Seeding the second hash independently (vs.
// hashing the same string with a fixed suffix) means its bits are not a
// function of the first hash's output, so a primary collision no longer forces
// an identical passport id.
const FNV_OFFSET_A = 0x811c9dc5;
const FNV_OFFSET_B = 0x7a2c9e35;
const FNV_PRIME = 0x01000193;

function fnv1a(input: string, seed: number): number {
  let hash = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME);
  }
  return hash >>> 0; // force 32-bit unsigned
}

/**
 * Deterministic, stable passport code for a horse, e.g. "XB-7Q2K-9F3M".
 * Derived purely from the permanent record id, so it never changes and never
 * collides for the same id. The primary hash supplies 32 bits and an
 * independently seeded hash supplies 8 more, for ~40 bits across the 32^8
 * code space — all in a safe JS integer, no BigInt, no dependency.
 */
export function animalPassportId(horseId: string | undefined | null): string {
  const id = (horseId ?? '').trim();
  if (!id) return 'XB-0000-0000';
  const primary = fnv1a(id, FNV_OFFSET_A);
  const secondary = fnv1a(id, FNV_OFFSET_B);
  let value = primary * 256 + (secondary & 0xff); // 40-bit, < 2^53
  let code = '';
  for (let i = 0; i < 8; i += 1) {
    code = CROCKFORD[value % 32] + code;
    value = Math.floor(value / 32);
  }
  return `XB-${code.slice(0, 4)}-${code.slice(4)}`;
}

// Gallery kinds that are an actual photograph of the animal. Pedigree scans and
// document covers are imagery but not a horse photo, so they must not satisfy
// the passport "Photo" requirement.
const HORSE_PHOTO_KINDS: ReadonlySet<GalleryAsset['kind']> = new Set(['Hero', 'Conformation', 'Sale Still']);

/**
 * True when the record has a real photograph of the animal — a profile image
 * or a gallery asset of a horse-photo kind with a usable URL. Pedigree scans
 * and document covers do not count. Exported so the passport can both score
 * completeness and decide whether a newly uploaded photo becomes the primary.
 */
export function hasHorsePhoto(horse: Pick<HorseRecord, 'profileImage' | 'gallery'>): boolean {
  if (filled(horse.profileImage)) return true;
  return (horse.gallery ?? []).some((asset) => HORSE_PHOTO_KINDS.has(asset.kind) && filled(asset.url));
}

export interface IdentityField {
  key: string;
  label: string;
  present: boolean;
}

export interface IdentityCompleteness {
  fields: IdentityField[];
  present: number;
  total: number;
  percent: number;
  missing: string[];
}

type IdentityInput = Pick<
  HorseRecord,
  | 'name'
  | 'breed'
  | 'sex'
  | 'foaledOn'
  | 'age'
  | 'color'
  | 'markings'
  | 'registered'
  | 'registrationNumber'
  | 'aqhaNumber'
  | 'bloodline'
  | 'microchipId'
  | 'owner'
  | 'profileImage'
  | 'gallery'
>;

function filled(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return value > 0;
  return Boolean(value);
}

/**
 * Honest identity completeness for the passport. Each field maps to a real
 * stored value; nothing is estimated. Used to tell the rancher exactly what a
 * buyer-facing passport still needs.
 */
export function identityCompleteness(horse: IdentityInput): IdentityCompleteness {
  const fields: IdentityField[] = [
    { key: 'name', label: 'Name', present: filled(horse.name) },
    { key: 'breed', label: 'Breed', present: filled(horse.breed) },
    { key: 'sex', label: 'Sex', present: filled(horse.sex) },
    { key: 'foaled', label: 'Foaled date', present: filled(horse.foaledOn) || filled(horse.age) },
    { key: 'color', label: 'Color & markings', present: filled(horse.color) || filled(horse.markings) },
    {
      key: 'registration',
      label: 'Registration',
      present: Boolean(horse.registered) && (filled(horse.registrationNumber) || filled(horse.aqhaNumber)),
    },
    { key: 'sire', label: 'Sire', present: filled(horse.bloodline?.sire) },
    { key: 'dam', label: 'Dam', present: filled(horse.bloodline?.dam) },
    { key: 'microchip', label: 'Microchip / brand ID', present: filled(horse.microchipId) },
    { key: 'owner', label: 'Owner of record', present: filled(horse.owner) },
    { key: 'photo', label: 'Photo', present: hasHorsePhoto(horse) },
  ];
  const present = fields.filter((field) => field.present).length;
  const total = fields.length;
  const percent = total === 0 ? 0 : Math.round((present / total) * 100);
  const missing = fields.filter((field) => !field.present).map((field) => field.label);
  return { fields, present, total, percent, missing };
}
