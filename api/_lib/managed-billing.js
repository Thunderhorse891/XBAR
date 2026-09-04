/*
 * Whether the server will create checkout sessions, answered in one place.
 *
 * This was two conventions. `/api/health` accepted the ordinary truthy set —
 * 1, true, yes, on — while `api/stripe/checkout.js` required the literal
 * string `true`, so a deployment configured with `MANAGED_BILLING_ENABLED=1`
 * had a readiness probe reporting healthy, a client offering checkout, and a
 * server rejecting every request as paused. Green, and unable to sell.
 *
 * The strict reading wins because it is the one that ACTS: the endpoint
 * creating Stripe sessions is the authority on whether the server will, and
 * `.env.example` and the go-live checklist have always documented `true`.
 * Widening it instead would turn real billing on for any deployment that had
 * written 1 and been safely inert until now, which is not a change a parser
 * cleanup gets to make.
 */
export function serverManagedBillingEnabled(env = process.env) {
  return env.MANAGED_BILLING_ENABLED?.trim().toLowerCase() === 'true';
}

/*
 * What the CLIENT does with its own flag, modelled faithfully rather than
 * assumed to match. `src/lib/platformConfig.ts` uses a generic reader shared
 * with every other VITE_ flag, so it accepts the broad set — and a readiness
 * probe that pretended otherwise would report a client which does not exist.
 */
export function clientManagedBillingEnabled(env = process.env) {
  const normalized = env.VITE_MANAGED_BILLING_ENABLED?.trim().toLowerCase() ?? '';
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}
