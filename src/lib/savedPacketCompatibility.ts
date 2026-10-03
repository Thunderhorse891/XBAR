import { PACKET_VERIFIER_SCRIPT } from './packetVerifierScript.js';
import { sha256 } from './sha256.js';

// The reviewed final v5 verifier shipped on main before customer branding.
// Earlier v5 scripts with known defects are intentionally NOT supported.
export const LEGACY_V5_VERIFIER_SHA256 = 'c735bacd18acf4cca6f3fe979c70f26744c26092fa47c2715803b0346e083d8b';

export function isSupportedPacketVerifier(script: string, version: unknown): boolean {
  return script === PACKET_VERIFIER_SCRIPT || (version === 5 && sha256(script) === LEGACY_V5_VERIFIER_SHA256);
}

export class SavedPacketCompatibilityError extends Error {
  constructor() {
    super(
      'This saved packet uses an older or unsupported verifier. Open Sale Packets, choose the horse and build a new packet from current records before sharing. Your saved original has not been changed.',
    );
    this.name = 'SavedPacketCompatibilityError';
  }
}

/**
 * A vault blob inherits the app's CSP. Admit the current verifier and the one
 * reviewed final v5 verifier pinned above. Broad historical acceptance would
 * restore known defects; neither version numbers nor a matching script name
 * alone grant executable provenance.
 * Refuse an incompatible packet before navigation, without changing its bytes
 * or pretending a newly generated packet would have the same seal or records.
 * This is a compatibility check, not a verification of the packet's contents.
 */
export async function assertSavedPacketCompatible(blob: Blob, type: string): Promise<void> {
  if (![type, blob.type].some((value) => value.split(';')[0].trim().toLowerCase() === 'text/html')) return;
  const html = await blob.text();
  // Other generated HTML (for example a bill of sale) has no packet verifier.
  if (!html.includes('xbar-verify-btn') && !html.includes('xbar-credential-payload')) return;

  const document = new DOMParser().parseFromString(html, 'text/html');
  const scripts = document.querySelectorAll('script');
  let version: unknown;
  const records = document.querySelectorAll('#xbar-credential-payload');
  try {
    if (records.length === 1) version = JSON.parse(records[0].textContent || '').version;
  } catch {
    // An unreadable payload never earns legacy compatibility.
  }
  if (
    scripts.length !== 1 ||
    scripts[0].attributes.length !== 0 ||
    !isSupportedPacketVerifier(scripts[0].textContent || '', version)
  ) {
    throw new SavedPacketCompatibilityError();
  }
}
