// Buyer-safe Animal Passport DTO.
//
// The ONLY sanctioned way to expose a horse record outside the workspace. Any
// public share / QR / buyer view must render from `toPublicPassport`, never from
// a raw HorseRecord. The mapping is a strict allowlist: it copies a fixed set of
// non-sensitive identity fields and nothing else, so newly added record fields
// can never leak by default. Private data — owner/ownership, financials
// (costBasis, insuredValue, ask price), medical, breeding, buyer interest,
// internal readiness/confidence, documents, location, microchip, notes,
// activity — is intentionally absent and must stay that way.

import type { HorseRecord } from '../types/xbar.js';
import { animalPassportId, isHorsePhotoAsset } from './animalPassport.js';

export interface PublicPassportDTO {
  /** Stable public identifier — safe to print/share; not the internal record id. */
  passportId: string;
  name: string;
  breed: string;
  sex: string;
  color: string;
  markings: string;
  foaledOn: string;
  age: number;
  /** Registration is shown only when the record is actually registered. */
  registered: boolean;
  registry: string;
  registrationNumber: string;
  sire: string;
  dam: string;
  /** A real horse photograph only (never a pedigree/document scan); '' when none. */
  photoUrl: string;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Resolve the primary buyer-visible photo: the profile image if it is a real
 * photo, else the first qualifying horse-photo gallery asset. Document scans and
 * pedigree images never qualify. */
function publicPhotoUrl(horse: Pick<HorseRecord, 'profileImage' | 'gallery'>): string {
  const gallery = horse.gallery ?? [];
  const profile = str(horse.profileImage);
  if (profile && gallery.some((asset) => isHorsePhotoAsset(asset) && str(asset.url) === profile)) {
    return profile;
  }
  const firstPhoto = gallery.find((asset) => isHorsePhotoAsset(asset));
  if (firstPhoto) return str(firstPhoto.url);
  // A profileImage with no matching gallery asset is trusted only if a real
  // photo exists; otherwise return nothing rather than risk exposing a doc URL.
  return '';
}

/**
 * Build the buyer-safe passport for a horse. Allowlist only — every field here is
 * safe to show a prospective buyer. Nothing else from the record is included.
 */
export function toPublicPassport(horse: HorseRecord): PublicPassportDTO {
  const registered = Boolean(horse.registered);
  return {
    passportId: animalPassportId(horse.id),
    name: str(horse.name),
    breed: str(horse.breed),
    sex: str(horse.sex),
    color: str(horse.color),
    markings: str(horse.markings),
    foaledOn: str(horse.foaledOn),
    age: typeof horse.age === 'number' && horse.age > 0 ? horse.age : 0,
    registered,
    registry: registered ? str(horse.registry) : '',
    registrationNumber: registered ? str(horse.registrationNumber) || str(horse.aqhaNumber) : '',
    sire: str(horse.bloodline?.sire),
    dam: str(horse.bloodline?.dam),
    photoUrl: publicPhotoUrl(horse),
  };
}

/** The exact set of keys a buyer-safe passport may contain. Consumers and tests
 * can assert against this so the surface never grows silently. */
export const PUBLIC_PASSPORT_KEYS: ReadonlyArray<keyof PublicPassportDTO> = [
  'passportId',
  'name',
  'breed',
  'sex',
  'color',
  'markings',
  'foaledOn',
  'age',
  'registered',
  'registry',
  'registrationNumber',
  'sire',
  'dam',
  'photoUrl',
];
