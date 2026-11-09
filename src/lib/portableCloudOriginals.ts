import {
  MAX_BACKUP_FILE_BYTES,
  blobToBase64,
  referencedVaultKeys,
  type PortableLocalFile,
  type UnbackedUpFile,
} from './localFileVault.js';
import { readStoredFile, MAX_DOWNLOAD_BYTES } from './downloadStoredFile.js';
import { isWorkspaceStorageKey } from './documentStoragePath.js';
import { sha256Bytes } from './sha256.js';
import type { StoredFileRef } from './storedFiles.js';

type FileRecord = StoredFileRef & {
  id?: string;
  title?: string;
  fileName?: string;
  contentSha256?: string;
  downloadUrl?: string;
};
type FileWorkspace = { documents?: FileRecord[]; expenseReceipts?: FileRecord[]; salePacketBuilds?: FileRecord[] };
const GROUPS = ['documents', 'expenseReceipts', 'salePacketBuilds'] as const;
export const BACKUP_CONTEXT_CHANGED =
  'Your account, ranch or permission changed. No backup was saved. Reopen the original ranch and try again.';

/** Copy cloud originals into a detached archive. Never update the live store or write cloud/vault objects. */
export async function includeCloudOriginals<T extends FileWorkspace>(
  workspace: T,
  localFiles: PortableLocalFile[],
  localSkipped: UnbackedUpFile[],
  context: { workspaceId: string; isCurrent: () => boolean },
  dependencies = { readStoredFile, now: () => Date.now(), newKey: () => `vault-backup-${crypto.randomUUID()}` },
  limits = { maxBytes: MAX_BACKUP_FILE_BYTES, timeoutMs: 30_000, totalMs: 180_000 },
): Promise<{ workspace: T; files: PortableLocalFile[]; skipped: UnbackedUpFile[] }> {
  const check = () => {
    if (!context.isCurrent()) throw new Error(BACKUP_CONTEXT_CHANGED);
  };
  check();
  const copy = structuredClone(workspace);
  const files = [...localFiles];
  const included = new Set(files.map((file) => file.key));
  const reserved = new Set(
    referencedVaultKeys(copy.documents ?? [], copy.expenseReceipts ?? [], copy.salePacketBuilds ?? []),
  );
  const omissions = new Map<string, UnbackedUpFile>();
  const cache = new Map<string, { file: PortableLocalFile; digest: string } | { message: string }>();
  let used = files.reduce((sum, file) => sum + file.size, 0);
  const deadline = dependencies.now() + limits.totalMs;
  for (const group of GROUPS) {
    for (const [index, record] of (copy[group] ?? []).entries()) {
      check();
      const name = record.fileName || record.title || 'Attached original';
      if (group === 'salePacketBuilds' && record.localFileKey && included.has(record.localFileKey)) continue;
      if (record.fileUrl?.trim() || (group === 'salePacketBuilds' && record.downloadUrl?.trim())) {
        const key = `linked:${group}:${record.id || index}`;
        omissions.set(key, { key, name, reason: 'Linked files must be downloaded separately.', location: 'link' });
        continue;
      }
      if (record.localFileKey && included.has(record.localFileKey)) continue;
      const path = record.storagePath;
      if (!path) continue;
      const omissionKey = `cloud:${group}:${record.id || index}`;
      const omit = (reason: string) =>
        omissions.set(omissionKey, { key: omissionKey, name, reason, location: 'cloud' });
      // Storage signing still enforces server policy. Refuse another ranch's namespace before even requesting a URL.
      if (
        !isWorkspaceStorageKey(context.workspaceId) ||
        path.split('/')[0] !== context.workspaceId.toLowerCase() ||
        path.split('/').some((part) => !part || part === '.' || part === '..') ||
        /[\\?#]|%(?:2e|2f|5c)/i.test(path)
      ) {
        omit('This original cannot be verified as belonging to the current ranch.');
        continue;
      }
      let result = cache.get(path);
      if (!result) {
        const remainingTime = deadline - dependencies.now();
        const remainingBytes = limits.maxBytes - used;
        if (remainingTime <= 0 || remainingBytes <= 0) {
          omit('The backup reached its time or size limit. Download this original separately.');
          continue;
        }
        const read = await dependencies.readStoredFile(
          { storagePath: path, fileName: name },
          context.isCurrent,
          undefined,
          Math.min(limits.timeoutMs, remainingTime),
          Math.min(MAX_DOWNLOAD_BYTES, remainingBytes),
        );
        check();
        if (!read.ok) result = { message: read.message };
        else {
          const digest = sha256Bytes(new Uint8Array(await read.blob.arrayBuffer()));
          check();
          const key = dependencies.newKey();
          if (
            reserved.has(key) ||
            included.has(key) ||
            [...cache.values()].some((entry) => 'file' in entry && entry.file.key === key)
          )
            throw new Error('A duplicate backup file identity was refused. No backup was saved.');
          result = {
            digest,
            file: {
              key,
              name: read.name,
              type: read.blob.type,
              size: read.blob.size,
              storedAt: new Date(dependencies.now()).toISOString(),
              data: await blobToBase64(read.blob),
            },
          };
          used += read.blob.size;
        }
        cache.set(path, result);
      }
      check();
      if ('message' in result) {
        omit(result.message);
        continue;
      }
      if (record.contentSha256 && record.contentSha256.toLowerCase() !== result.digest) {
        omit('The downloaded original does not match this record’s saved file fingerprint.');
        continue;
      }
      record.localFileKey = result.file.key;
      if (!included.has(result.file.key)) {
        files.push(result.file);
        included.add(result.file.key);
      }
    }
  }
  check();
  const wanted = new Set(
    referencedVaultKeys(copy.documents ?? [], copy.expenseReceipts ?? [], copy.salePacketBuilds ?? []),
  );
  return {
    workspace: copy,
    files,
    skipped: [
      ...localSkipped.filter((entry) => wanted.has(entry.key) && !included.has(entry.key)),
      ...omissions.values(),
    ],
  };
}
