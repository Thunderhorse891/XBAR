/*
 * Where a record's file actually is — asked in one place.
 *
 * Three call sites in Documents.tsx each wrote their own version of
 * `fileUrl || storagePath` to decide whether to offer "Open file". Adding a
 * fourth location for the bytes (the on-device vault) would have meant getting
 * the same expression right in three places, and a screen that offers the
 * button in one list and hides it in another is worse than one that is
 * consistently wrong.
 */

export interface StoredFileRef {
  /** A direct link, for records that came with one. */
  fileUrl?: string;
  /** A path in the Supabase document bucket. */
  storagePath?: string;
  /** A key into this device's file vault. */
  localFileKey?: string;
}

export type StoredFileLocation = 'link' | 'device' | 'cloud' | 'none';

/**
 * Ordered the same way `getDocumentAccessUrl` resolves, so what the UI says
 * about a file and what happens when it is clicked cannot disagree.
 */
export function storedFileLocation(record: StoredFileRef): StoredFileLocation {
  if (record.fileUrl?.trim()) return 'link';
  if (record.localFileKey) return 'device';
  if (record.storagePath) return 'cloud';
  return 'none';
}

export function hasStoredFile(record: StoredFileRef): boolean {
  return storedFileLocation(record) !== 'none';
}

const LOCATION_LABELS: Record<StoredFileLocation, string> = {
  link: 'Linked file',
  device: 'On this device',
  cloud: 'In cloud storage',
  none: 'No file attached',
};

/**
 * Said out loud, because in a local-first workspace it matters.
 *
 * "On this device" is a real limitation a rancher needs to know about before
 * they reinstall a browser or expect the file on their phone — and it is the
 * honest answer, which the previous code could not give because it had thrown
 * the bytes away and kept the file name.
 */
export function storedFileLabel(record: StoredFileRef): string {
  return LOCATION_LABELS[storedFileLocation(record)];
}
