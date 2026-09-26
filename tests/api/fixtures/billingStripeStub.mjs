/*
 * The 'stripe' replacement used by the billing endpoint behavioral tests
 * (see billingLoader.mjs).
 *
 * The test registers one scripted fake per file with __setBillingStripe; the
 * default export is the class the handlers `new` up, and the constructor
 * returns the registered fake. The fake's shape mirrors the slice of the
 * Stripe SDK the handlers touch:
 *
 *   {
 *     webhooks: { constructEvent },
 *     subscriptions: { retrieve, list },
 *     customers: { create },
 *     checkout: { sessions: { create, expire, retrieve, list } },
 *   }
 *
 * constructEvent is a faithful reimplementation of stripe-node's webhook
 * signature check (not a stub): `t=<unix seconds>,v1=<hex HMAC-SHA256>` over
 * `${timestamp}.${rawBody}`, compared in constant time with a 300-second
 * tolerance. It was verified both directions against the real SDK
 * (real header accepted here; headers signed here accepted there), so the
 * "signed test event" in these tests is genuinely signed.
 */

import crypto from 'node:crypto';

const registry = { stripe: null };

export function __setBillingStripe(fake) {
  registry.stripe = fake;
}

export default class Stripe {
  constructor() {
    if (!registry.stripe) {
      throw new Error('billingStripeStub: no fake registered via __setBillingStripe');
    }
    return registry.stripe;
  }
}

const TOLERANCE_SECONDS = 300;

function parseHeader(header) {
  const details = {};
  for (const part of String(header || '').split(',')) {
    const separator = part.indexOf('=');
    if (separator > 0) {
      details[part.slice(0, separator)] = part.slice(separator + 1);
    }
  }
  return details;
}

export function verifyTestWebhookSignature(rawBody, header, secret) {
  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody ?? '');
  const details = parseHeader(header);
  const timestamp = Number(details.t);
  if (!Number.isFinite(timestamp)) {
    throw new Error('Unable to extract timestamp from stripe-signature header.');
  }

  const signedPayload = `${timestamp}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload, 'utf8').digest('hex');
  const actual = details.v1 || '';
  const actualBuffer = Buffer.from(actual, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (actualBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('No signatures found matching the expected signature for payload.');
  }

  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > TOLERANCE_SECONDS) {
    throw new Error('Timestamp outside the tolerance zone.');
  }

  return JSON.parse(payload);
}

export function signTestWebhookEvent(payloadString, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const body = String(payloadString);
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
  return `t=${timestamp},v1=${signature}`;
}
