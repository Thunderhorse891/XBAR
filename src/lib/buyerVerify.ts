// Public packet-verification client.
//
// Calls the anonymous /api/buyer/verify endpoint, which returns the
// server-anchored seal XBAR computed and stored for a sale packet at generation
// time, plus the buyer-facing facts under that seal. A buyer compares what XBAR
// sealed against the copy they were sent; any difference means the packet was
// altered. This never fetches the PDF — only the seal and its facts.

export interface VerifiedSeal {
  version: number;
  anchor: 'server';
  sealCode: string;
  digest: string;
  sealedAt: string;
}

export interface VerifiedFacts {
  horseName: string;
  barnName: string;
  registry: string;
  registrationNumber: string;
  breed: string;
  sex: string;
  color: string;
  legalOwner: string;
  transferStatus: string;
  documents: Array<{ type: string; title: string }>;
  sealedAt: string;
}

export type VerifyResult =
  | { state: 'verified'; seal: VerifiedSeal; facts: VerifiedFacts }
  | { state: 'not-found'; message: string }
  | { state: 'unanchored'; message: string }
  | { state: 'error'; message: string };

/** Verify a packet by its id against XBAR's stored server-anchored seal. */
export async function verifyPacket(packetId: string): Promise<VerifyResult> {
  const id = packetId.trim();
  if (!id) {
    return { state: 'error', message: 'Enter the packet code from your sale packet.' };
  }

  let response: Response;
  try {
    response = await fetch(`/api/buyer/verify?packetId=${encodeURIComponent(id)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
  } catch {
    return { state: 'error', message: 'Verification is unreachable. Check your connection and try again.' };
  }

  let body: Record<string, unknown> | null;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    body = null;
  }

  if (response.status === 404 || (body && body.found === false)) {
    return {
      state: 'not-found',
      message: (body?.message as string) || 'No packet with that code was found in XBAR’s records.',
    };
  }

  if (!response.ok || !body || body.ok !== true) {
    return {
      state: 'error',
      message: (body?.message as string) || 'Verification is temporarily unavailable. Try again.',
    };
  }

  if (body.anchored !== true || !body.seal || !body.facts) {
    return {
      state: 'unanchored',
      message:
        (body.message as string) ||
        'This packet has no server-anchored seal on record. Ask the seller to regenerate it.',
    };
  }

  return { state: 'verified', seal: body.seal as VerifiedSeal, facts: body.facts as VerifiedFacts };
}
