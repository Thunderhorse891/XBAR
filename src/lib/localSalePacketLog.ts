export const localSalePacketLogKey = 'xbar-local-sale-packet-log';
export const localSalePacketLogChangedEvent = 'xbar-local-sale-packet-log-changed';

export type LocalSalePacketLogEntry = {
  horseId?: string;
  horseName?: string;
  action?: 'previewed' | 'exported' | string;
  packetScore?: number;
  releaseStatus?: string;
  includedDocuments?: number;
  createdAt?: string;
};

function safeParseLog(value: string | null): LocalSalePacketLogEntry[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? (parsed.filter((entry) => entry && typeof entry === 'object') as LocalSalePacketLogEntry[])
      : [];
  } catch {
    return [];
  }
}

export function readLocalSalePacketLog(): LocalSalePacketLogEntry[] {
  if (typeof window === 'undefined') return [];
  return safeParseLog(window.localStorage.getItem(localSalePacketLogKey));
}

export function countLocalSalePacketGenerations() {
  return readLocalSalePacketLog().length;
}

export function appendLocalSalePacketLog(entry: LocalSalePacketLogEntry) {
  if (typeof window === 'undefined') return [];
  const current = readLocalSalePacketLog();
  const next = [{ ...entry, createdAt: new Date().toISOString() }, ...current].slice(0, 1000);
  window.localStorage.setItem(localSalePacketLogKey, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent(localSalePacketLogChangedEvent, { detail: next }));
  return next;
}
