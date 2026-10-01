import type { SalePacketBuild } from '../types/xbar.js';

/*
 * Re-opening a packet the cloud built.
 *
 * The server signs a packet's download link for 72 hours, and that link was
 * the only address the app kept: both saved-packet lists linked straight to it.
 * A seller who came back on day four to send the packet to the next buyer got
 * a storage error page, and the only way out was to build — and pay for — the
 * same packet again.
 *
 * The server can sign a fresh link for a packet it holds, by the packet's id,
 * without re-assembling it. So a cloud packet is opened by that id, and the
 * saved link is used only for a packet with no id to ask for.
 *
 * Kept free of the app's `@/` imports so the node test runner can load it.
 */

/** The only shape of id the server has ever issued (`api/sale-packets.js`). */
const SERVER_PACKET_ID = /^packet-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The server's id for a packet it built, or '' when there is none to ask for.
 *
 * Packets saved before the id was stored on the record still carry it: the
 * server seal's payload names the packet it seals. Only a server seal is read —
 * a local seal names a packet the server never saw. The id comes from workspace
 * data, which can arrive in an imported backup, so anything not shaped like a
 * server id is refused; and the server looks it up only inside the caller's own
 * workspace, so a forged one can reach nothing the caller could not already.
 */
export function serverPacketIdOf(packet: Pick<SalePacketBuild, 'serverPacketId' | 'credential'>): string {
  const recorded = packet.serverPacketId;
  if (typeof recorded === 'string' && SERVER_PACKET_ID.test(recorded)) return recorded;

  const credential = packet.credential;
  if (credential?.anchor !== 'server' || typeof credential.payload !== 'string') return '';
  try {
    const sealed: unknown = JSON.parse(credential.payload);
    const sealedId = sealed && typeof sealed === 'object' ? (sealed as { packetId?: unknown }).packetId : undefined;
    return typeof sealedId === 'string' && SERVER_PACKET_ID.test(sealedId) ? sealedId : '';
  } catch {
    return '';
  }
}

export type RefreshedPacketAccess = { ok: true; url: string } | { ok: false; message: string };

const REFRESH_FAILED = 'The packet could not be re-opened. Try again in a moment.';
const PACKET_GONE = 'This sale packet is no longer stored in this workspace. Build a new one to send it.';

/**
 * What the server's answer to "sign packet X again" means for the person
 * waiting on it.
 *
 * A link is returned only for the packet that was asked for. A refusal keeps
 * the server's own reason — lost access, a packet no longer recorded, a stored
 * path that does not belong to the workspace — because each asks for something
 * different from the seller, and a generic failure would hide which.
 */
export function readRefreshedPacket(payload: unknown, serverPacketId: string, httpOk = true): RefreshedPacketAccess {
  const body = payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
  const serverMessage = typeof body.message === 'string' && body.message.trim() ? body.message : '';
  if (!httpOk || body.ok !== true) {
    return { ok: false, message: serverMessage || REFRESH_FAILED };
  }

  const packets = Array.isArray(body.packets) ? body.packets : [];
  const match = packets.find(
    (entry): entry is Record<string, unknown> =>
      Boolean(entry) && typeof entry === 'object' && (entry as Record<string, unknown>).packetId === serverPacketId,
  );
  if (!match) return { ok: false, message: PACKET_GONE };

  const url = typeof match.downloadUrl === 'string' ? match.downloadUrl : '';
  if (!url) {
    const reason = typeof match.downloadUnavailable === 'string' ? match.downloadUnavailable.trim() : '';
    return { ok: false, message: reason || REFRESH_FAILED };
  }
  return { ok: true, url };
}
