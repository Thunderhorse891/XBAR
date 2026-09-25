import { PACKET_VERIFIER_SCRIPT } from './packetVerifierScript.js';

export class SavedPacketCompatibilityError extends Error {
  constructor() {
    super(
      'This saved packet uses an older or unsupported verifier. Open Sale Packets, choose the horse and build a new packet from current records before sharing. Your saved original has not been changed.',
    );
    this.name = 'SavedPacketCompatibilityError';
  }
}

/**
 * A vault blob inherits the app's CSP. Only the current verifier is permitted;
 * allowing historical verifiers would also restore their known defects.
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
  if (scripts.length !== 1 || scripts[0].attributes.length !== 0 || scripts[0].textContent !== PACKET_VERIFIER_SCRIPT) {
    throw new SavedPacketCompatibilityError();
  }
}
