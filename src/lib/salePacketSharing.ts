import type { SalePacketBuild } from '../types/xbar.js';
import { buildApiUrl } from './backendApi.js';
import { saveBlobAsFile } from './fileDownload.js';
import { mayReadVaultEntry, readLocalFile } from './localFileVault.js';
import { hasNativeBridge, isNativeApp } from './nativePlatform.js';
import { assertSavedPacketCompatible } from './savedPacketCompatibility.js';

export type PreparedSalePacket = { file: File; format: 'PDF' | 'HTML' };
export type PacketHandoffResult =
  { status: 'handed-off' | 'download-started' | 'cancelled' } | { status: 'unavailable' | 'error'; message: string };

export const MAX_SHARE_PACKET_BYTES = 64 * 1024 * 1024;
export const STALE_PACKET_MESSAGE =
  'The ranch, packet or permissions changed. Close this dialog and review the packet again.';

function assertCurrent(isCurrent: () => boolean) {
  if (!isCurrent()) throw new Error(STALE_PACKET_MESSAGE);
}

/** Only a freshly authorized URL for this exact cloud packet can supply bytes. */
export function isTrustedPacketDownloadUrl(
  url: string,
  supabaseUrl: string,
  workspaceId: string,
  packetId: string,
): boolean {
  try {
    const parsed = new URL(url);
    const configured = new URL(supabaseUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);
    return (
      parsed.protocol === 'https:' &&
      parsed.origin === configured.origin &&
      !parsed.username &&
      !parsed.password &&
      !parsed.hash &&
      parts.length === 8 &&
      parts.slice(0, 4).join('/') === 'storage/v1/object/sign' &&
      /^[a-zA-Z0-9_-]+$/.test(parts[4]) &&
      parts[5] === workspaceId.toLowerCase() &&
      /^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(parts[6]) &&
      /^[a-zA-Z0-9_-]+$/.test(packetId) &&
      parts[7] === `${packetId}.pdf` &&
      Boolean(parsed.searchParams.get('token'))
    );
  } catch {
    return false;
  }
}

/** Studio ids predate server ids; the sealed cloud payload preserves the actual packet identity. */
function cloudPacketId(packet: SalePacketBuild, context: { workspaceId: string; supabaseUrl: string }): string {
  if (packet.credential?.anchor === 'server') {
    let payload: { packetId?: unknown; horseId?: unknown };
    try {
      payload = JSON.parse(packet.credential.payload);
    } catch {
      throw new Error('The saved packet identity is unreadable. Build a new packet before sharing.');
    }
    if (
      typeof payload?.packetId !== 'string' ||
      payload.horseId !== packet.horseId ||
      !/^[a-zA-Z0-9_-]+$/.test(payload.packetId)
    ) {
      throw new Error('The saved packet identity does not match this horse. Build a new packet before sharing.');
    }
    return payload.packetId;
  }
  // Legacy records may lack a seal. Read only the identifier from a narrowly
  // validated old link; never fetch it. The server still authorizes the lookup.
  if (packet.downloadUrl) {
    try {
      const id =
        new URL(packet.downloadUrl).pathname
          .split('/')
          .pop()
          ?.replace(/\.pdf$/, '') ?? '';
      if (isTrustedPacketDownloadUrl(packet.downloadUrl, context.supabaseUrl, context.workspaceId, id)) return id;
    } catch {
      /* use the recorded id; the authorized endpoint must confirm it */
    }
  }
  return packet.id;
}

export function packetShareFileName(name: string | undefined, format: 'PDF' | 'HTML'): string {
  const stem = (name ?? 'xbar-sale-packet')
    .replace(/\.[^.]*$/, '')
    .replace(/[^a-zA-Z0-9 _-]/g, '-')
    .trim()
    .slice(0, 100);
  return `${stem || 'xbar-sale-packet'}.${format.toLowerCase()}`;
}

/** Bounds streamed responses too: a missing Content-Length is not an unlimited allocation. */
async function readPacketResponse(response: Response, isCurrent: () => boolean): Promise<Blob> {
  if (!response.ok) throw new Error('The packet could not be downloaded. Try preparing it again.');
  if (Number(response.headers.get('content-length')) > MAX_SHARE_PACKET_BYTES) {
    throw new Error(
      'This packet exceeds the 64 MB sharing limit. Use its existing download link or build a smaller packet.',
    );
  }
  if (!response.body) throw new Error('The packet download returned no file.');
  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      assertCurrent(isCurrent);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SHARE_PACKET_BYTES)
        throw new Error(
          'This packet exceeds the 64 MB sharing limit. Use its existing download link or build a smaller packet.',
        );
      chunks.push(new Uint8Array(value).buffer);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return new Blob(chunks, { type: 'application/pdf' });
}

async function prepareSalePacketFileBytes(
  packet: SalePacketBuild,
  context: {
    ownerId: string;
    workspaceId: string;
    accessToken: string;
    supabaseUrl: string;
    isCurrent: () => boolean;
    signal?: AbortSignal;
  },
  dependencies = { readLocalFile, fetch: globalThis.fetch },
): Promise<PreparedSalePacket> {
  const { isCurrent } = context;
  assertCurrent(isCurrent);
  let blob: Blob;
  let format: 'PDF' | 'HTML';
  let name = packet.fileName;
  if (packet.localFileKey) {
    const entry = await dependencies.readLocalFile(packet.localFileKey);
    assertCurrent(isCurrent);
    if (!entry || !mayReadVaultEntry(entry, context.ownerId)) {
      throw new Error(
        'This packet is not available in this ranch on this device. Open it on the device where it was generated, or build a new packet.',
      );
    }
    if (entry.generated !== true)
      throw new Error('This file is not a recognized generated packet. Build a new packet before sharing.');
    blob = entry.blob;
    const type = entry.type.split(';')[0].trim().toLowerCase();
    if (type !== 'text/html' && type !== 'application/pdf')
      throw new Error('This packet format cannot be shared. Build a new PDF or HTML packet.');
    format = type === 'text/html' ? 'HTML' : 'PDF';
    name ||= entry.name;
    if (blob.size > MAX_SHARE_PACKET_BYTES)
      throw new Error('This packet exceeds the 64 MB sharing limit. Open the original or build a smaller packet.');
    await assertSavedPacketCompatible(blob, entry.type);
  } else {
    if (!context.workspaceId || !context.accessToken || !context.supabaseUrl) {
      throw new Error('Sign in to the ranch that generated this cloud packet, or use its existing download link.');
    }
    // Never fetch the saved downloadUrl: imported records can contain arbitrary
    // URLs, and signed links expire. This endpoint rechecks workspace membership.
    const packetId = cloudPacketId(packet, context);
    const query = new URLSearchParams({ workspaceId: context.workspaceId, horseId: packet.horseId });
    const response = await dependencies.fetch(buildApiUrl(`/api/sale-packets?${query}`), {
      headers: { Authorization: `Bearer ${context.accessToken}` },
      signal: context.signal,
      redirect: 'error',
    });
    assertCurrent(isCurrent);
    const payload = await response.json();
    assertCurrent(isCurrent);
    if (!response.ok || payload?.ok !== true || !Array.isArray(payload.packets)) {
      throw new Error(
        'The ranch could not authorize this packet download. Check your connection and access, then try again.',
      );
    }
    const matches = payload.packets.filter(
      (item: { packetId?: string; horseId?: string } | null) =>
        item?.packetId === packetId && item.horseId === packet.horseId,
    );
    if (
      matches.length !== 1 ||
      typeof matches[0].downloadUrl !== 'string' ||
      !isTrustedPacketDownloadUrl(matches[0].downloadUrl, context.supabaseUrl, context.workspaceId, packetId)
    ) {
      throw new Error(
        'A current download for this packet is unavailable. It may be older than the latest 50 packets for this horse. Open its existing download link or build a new packet.',
      );
    }
    const download = await dependencies.fetch(matches[0].downloadUrl, {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal: context.signal,
    });
    assertCurrent(isCurrent);
    blob = await readPacketResponse(download, isCurrent);
    format = 'PDF';
  }
  assertCurrent(isCurrent);
  if (!blob.size) throw new Error('This packet is empty. Build a new packet before sharing.');
  if (format === 'PDF' && (await blob.slice(0, 5).text()) !== '%PDF-')
    throw new Error('The stored packet is not a readable PDF. Build a new packet before sharing.');
  assertCurrent(isCurrent);
  return {
    file: new File([blob], packetShareFileName(name, format), {
      type: format === 'PDF' ? 'application/pdf' : 'text/html',
    }),
    format,
  };
}

/** Bounded network and body reads; retry is always an explicit new preparation. */
export async function prepareSalePacketFile(
  packet: SalePacketBuild,
  context: Parameters<typeof prepareSalePacketFileBytes>[1],
  dependencies?: Parameters<typeof prepareSalePacketFileBytes>[2],
): Promise<PreparedSalePacket> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  context.signal?.addEventListener('abort', cancel, { once: true });
  if (context.signal?.aborted) controller.abort();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 45_000);
  try {
    return await prepareSalePacketFileBytes(packet, { ...context, signal: controller.signal }, dependencies);
  } catch (error) {
    if (timedOut) {
      throw Object.assign(
        new Error('Preparing the packet timed out. Check your connection and try preparing it again.'),
        { cause: error },
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    context.signal?.removeEventListener('abort', cancel);
  }
}

export function canSharePacketFile(file: File): boolean {
  if (hasNativeBridge()) return true;
  if (isNativeApp()) return false;
  try {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] })
    );
  } catch {
    return false;
  }
}

/** Called directly from the final click: no asynchronous preparation before Web Share. */
export async function sharePreparedSalePacket(
  prepared: PreparedSalePacket,
  isCurrent: () => boolean,
): Promise<PacketHandoffResult> {
  if (!isCurrent()) return { status: 'error', message: STALE_PACKET_MESSAGE };
  if (!canSharePacketFile(prepared.file))
    return {
      status: 'unavailable',
      message:
        'This device cannot share this file type. Download it and upload it manually where the format and platform rules allow.',
    };
  try {
    if (hasNativeBridge()) {
      const result = await saveBlobAsFile(prepared.file.name, prepared.file, { shouldContinue: isCurrent });
      if (!result.ok)
        return /cancel/i.test(result.reason) ? { status: 'cancelled' } : { status: 'error', message: result.reason };
    } else {
      await navigator.share({ files: [prepared.file], title: prepared.file.name });
    }
    return { status: 'handed-off' };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') return { status: 'cancelled' };
    return { status: 'error', message: 'The file was not handed off. Try again, or download it for manual upload.' };
  }
}

export async function downloadPreparedSalePacket(
  prepared: PreparedSalePacket,
  isCurrent: () => boolean,
): Promise<PacketHandoffResult> {
  if (!isCurrent()) return { status: 'error', message: STALE_PACKET_MESSAGE };
  try {
    const result = await saveBlobAsFile(prepared.file.name, prepared.file, { shouldContinue: isCurrent });
    if (!result.ok)
      return /cancel/i.test(result.reason) ? { status: 'cancelled' } : { status: 'error', message: result.reason };
    return { status: result.via === 'browser' ? 'download-started' : 'handed-off' };
  } catch {
    return { status: 'error', message: 'The file could not be downloaded. Try again.' };
  }
}
