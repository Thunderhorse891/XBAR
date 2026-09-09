# Server-side recovery consumption — design

**Status: design only.** Nothing here is implemented. No migration is written, no
endpoint exists, no cloud or configuration change has been made or is proposed
without authorization. This document exists because a reviewer asked for the
proposal to be published with its exact remaining requirements rather than
asserted in a comment.

It answers three corrections raised against the sketch in PR #212:

1. If RLS denies all client access and the endpoint holds only the anon key,
   what trusted database path performs the conditional insert?
2. How does single-use enforcement hold if the same bearer can still call
   GoTrue's `PUT /auth/v1/user` directly?
3. How is a `session_id` established as a _recovery_ attempt rather than an
   ordinary signed-in session?

Two of the three answers correct something I previously wrote.

## Why anything server-side is wanted

Browser-side arbitration of a recovery password change is best effort, and the
residuals are named rather than hidden:

- **No Web Locks, no exclusion.** `safari13` is in `vite.config.ts`'s
  `build.target`, so a shipped target has no `navigator.locks`. The fallback
  narrows the window; it cannot close it, because `localStorage` has no
  compare-and-set.
- **A suspended tab cannot renew a lease.** A timer does not run in a suspended
  tab, so an expiry-based claim can lapse underneath a request that is still in
  flight. No client-side lease can fence that; only a durable row can.

## Correction 1 — the trusted database path

**My earlier sketch said the endpoint "needs the anon key only (no service-role
key, no new secret)". That was wrong, and self-contradictory.** A table whose RLS
denies every client role cannot be written by a client holding the anon key.
Either RLS is relaxed — which I explicitly do not propose — or a trusted path
performs the insert.

The repository already has that path, and already uses it twice:

- `api/_lib/supabase-admin.js` builds a service-role client from
  `SUPABASE_SERVICE_ROLE_KEY`, and `api/account/delete.js` already depends on
  it. **This design therefore introduces no secret beyond one the deployment
  already needs** for in-app account deletion.

  Stated precisely, because an earlier draft overreached: that is a fact about
  the code, not about the deployment. `getSupabaseAdmin()` returns null without
  the variable and the endpoint answers 503, so account deletion is simply
  unavailable where it is unset. **Whether it is actually set in production is
  unverified here** — no Vercel environment was read, and nothing in this
  repository can establish it.

- `supabase/migrations/20260826_checkout_session_lock.sql` already establishes
  the house rule from `20260822_restrict_anon_rpc_surface.sql`: the claim
  function `xbar_claim_checkout_lock` is `SECURITY DEFINER` and executable by
  `service_role` only.

So the conditional insert is an RPC on the same pattern:

- `xbar_claim_recovery_consumption(p_user_id uuid, p_session_id text)`,
  `SECURITY DEFINER`, `set search_path = public, pg_temp`.
- `revoke all on function ... from public, anon, authenticated;`
  `grant execute on function ... to service_role;`
- RLS on `recovery_consumptions` denies all client roles and **is not relaxed**.
  `anon` and `authenticated` gain nothing they did not have; the table is
  unreadable and unwritable from any browser.

**How the caller is verified — not by trusting the request body:**

- The endpoint reads the bearer from `Authorization`.
- It calls `supabase.auth.getUser(accessToken)` on the service-role client — the
  same verification `api/account/delete.js` performs. A forged, expired or
  foreign token fails here.
- `sub` is taken from the **verified user**, never from the body. `session_id`
  and `amr` are read from the token payload and are only trusted for a token
  that verification already accepted.

The function takes `p_user_id` rather than reading `auth.uid()` because a
service-role call has no `auth.uid()`. That is worth stating plainly: **the
function is only as safe as its EXECUTE grant**, which is why the grant is
`service_role` only and why the endpoint's verification is the trust boundary.
An `authenticated`-executable variant reading `auth.uid()` would need no
service-role key, but a browser could then call it directly — and, more to the
point, a browser can simply _not_ call it. It buys nothing the endpoint does not
already provide, so it is rejected.

## Correction 2 — single use does not hold against the bearer

Asked directly: how does single-use enforcement hold if the same bearer can
still call GoTrue's `PUT /auth/v1/user`?

**It does not, and I should not have implied otherwise.** Anyone holding the
recovery session's access token can call GoTrue at its own host, bypassing every
XBAR endpoint and every row in every XBAR table.

Checking this reframed the property worth having, and the reframing matters more
than the original claim did:

**The recovery _link_ is already single-use, at GoTrue, without any of this.**
The OTP is consumed at `/verify` — so thoroughly that Supabase's own
troubleshooting guide names email-prefetching security scanners consuming it
_before the customer clicks_ as the common cause of "token has expired"
([OTP verification failures](https://supabase.com/docs/guides/troubleshooting/otp-verification-failures-token-has-expired-or-otp_expired-errors-5ee4d0)).

So the exposure was never "the link can be redeemed twice". It is narrower:
**one validated recovery session can produce more than one password mutation**,
because the session token minted from that single redemption is an ordinary JWT,
valid for its lifetime.

What the consumption row therefore buys:

- It serializes **XBAR's own path**: at most one `PUT` per
  `(user_id, session_id)` through `/api/account/recovery-password`. The unique
  constraint is the compare-and-set `localStorage` does not have.
- It survives reload, token refresh and tab suspension — precisely the two
  residuals above.
- It leaves a durable record of the attempt and its outcome.

What it does **not** buy:

- Single use of the token. Impossible while the browser holds a GoTrue-capable
  token.
- Any constraint on a caller who never uses the endpoint.

The only architecture in which single use is a real property is one where the
recovery session never reaches the browser: the link lands on a server route,
the server verifies the OTP and applies the password change, and the browser
receives a session only afterwards. That is a different flow, not a patch, and
it is not proposed inside this PR.

**A requirement follows from this:** the client must be changed to route the
recovery password change through the endpoint. Left as-is, the row records
nothing, and shipping the table alone would be worse than shipping neither —
protection that is visible in the schema and absent in the flow.

## Correction 3 — telling a recovery session from an ordinary one

Asked: how is `session_id` established as a recovery attempt rather than an
ordinary signed-in session?

Via the `amr` claim, and it **is** documented — Supabase's
[JWT Claims Reference](https://supabase.com/docs/guides/auth/jwt-fields)
enumerates the `amr.method` values, and `"recovery"` ("Account recovery") is
among them. The
[Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)
schema enumerates the same set as `authentication_method`, and lists both `amr`
and `session_id` among its required claims.

Two things must not be glossed over:

- **The installed client library's types settle nothing.**
  `@supabase/auth-js`'s `AMRMethods` union is
  `["password", "otp", "oauth", "totp", "mfa/totp", "mfa/phone", "mfa/webauthn",
"anonymous", "sso/saml", "magiclink", "web3",
"oauth_provider/authorization_code"]` — no `recovery`. It is widened with
  `(string & {})` so it does not reject the value, and the library's own
  documented example shows `"method": "email"`, which is likewise absent from
  that union. The union is simply not exhaustive of what the server emits. The
  server's documentation is the authority, and **observation on a real token is
  the only thing that confirms this project's behaviour**.
- **The same enumeration contains `"token_refresh"`.** A recovery session whose
  access token has been refreshed may carry that method. The check must
  therefore be _"does the `amr` array contain an entry whose method is
  `recovery`"_ — never _"is the most recent method `recovery`"_. Inverting that
  fails closed against exactly the customer who was slow, which is the customer
  this flow exists for.

Fail-closed rule: **no `amr`, or no `recovery` entry, refuses.** An ordinary
signed-in password change is a different capability with a different
verification (re-entering the current password) and does not come here.

`session_id` is the key because it is stable across a refresh and new per link.
That is not assumed: the auth-smoke suite in this PR drives a real auth-js
refresh — expired stored session, `visibilitychange`, GoTrue's token endpoint
answering — and asserts a refreshed token does not make a spent link look
unused.

## Sketch

Not written as a migration, and deliberately not placed in
`supabase/migrations/`, so it cannot be applied by accident.

```sql
create table if not exists public.recovery_consumptions (
  user_id     uuid        not null references auth.users (id) on delete cascade,
  session_id  text        not null,
  outcome     text        not null default 'in_flight'
              check (outcome in ('in_flight', 'applied', 'refused', 'unknown')),
  claimed_at  timestamptz not null default now(),
  settled_at  timestamptz,
  primary key (user_id, session_id)          -- the atomic step
);

alter table public.recovery_consumptions enable row level security;
-- No policies. Deny-all for anon and authenticated is the intent; the
-- SECURITY DEFINER function below is the only writer.

create or replace function public.xbar_claim_recovery_consumption(
  p_user_id uuid, p_session_id text
) returns boolean
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.recovery_consumptions (user_id, session_id)
  values (p_user_id, p_session_id)
  on conflict (user_id, session_id) do nothing;
  return found;   -- true only for the request that won the insert
end;
$$;

revoke all on function public.xbar_claim_recovery_consumption(uuid, text)
  from public, anon, authenticated;
grant execute on function public.xbar_claim_recovery_consumption(uuid, text)
  to service_role;
```

Endpoint outline — `POST /api/account/recovery-password`:

1. `applyCors` / method check / `enforceRateLimit` (existing helpers).
2. `getSupabaseAdmin()`; **503 if absent**, never a silent success.
3. Verify the bearer with `supabase.auth.getUser(token)`; 401 on failure.
4. Decode the payload; require `session_id`, and require an `amr` entry whose
   method is `recovery`. **403 otherwise.**
5. `xbar_claim_recovery_consumption(verifiedUserId, session_id)`.
   `false` ⇒ 409 "this reset link has already been used".
6. Only on winning the claim, proxy `PUT /auth/v1/user` **with the caller's own
   token** — the endpoint never elevates the password change to service role.
7. Settle the row: `applied` / `refused` (releasable for retry, since GoTrue
   explicitly rejected — e.g. a password that fails policy) / `unknown` on a
   network-ambiguous outcome. **`unknown` is never released**, because the
   request may have reached GoTrue.

## Exact remaining requirements

Ordered; the first one gates everything after it.

1. **Observe `amr` on a real recovery token.** Until a genuine recovery link
   from this project is opened and its claims read, step 4 above is unproven and
   the design cannot ship — it would either refuse every real customer or be
   loosened into meaninglessness. `docs/GO-LIVE-CHECKLIST.md` §7 item 2 produces
   exactly this artifact as a side effect.
2. **A migration**, on the pattern of `20260826`, with its own applied/rollback
   header. Additive; no rewrite of an existing table.
3. **The endpoint**, plus a framework-free helper in `api/_lib/` so the claim,
   `amr` and settle decisions are unit-testable without a live Supabase —
   matching `api/_lib/account-deletion.js`.
   **Confirm first that `SUPABASE_SERVICE_ROLE_KEY` is set in the deployment**;
   if it is not, this endpoint answers 503 exactly as account deletion does, and
   the protection would be absent in production while present in the code.
4. **A client change** routing the recovery password change through the endpoint
   (see Correction 2 — without it the table is decorative).
5. **Tests**: two concurrent claims for one `(user_id, session_id)` where exactly
   one wins; an ordinary signed-in token refused at step 4; a refreshed recovery
   token still recognised; `unknown` not releasing; and a rendered case in the
   auth-smoke suite for the 409.
6. **Rate limiting** reusing `enforceRateLimit` with its own bucket.

## Not authorized, and not done

- No migration has been applied, and this design deliberately does not live in
  the migrations directory.
- No Supabase configuration, RLS policy, grant, or Vercel environment variable
  has been changed.
- No production deployment or merge is implied by publishing this.
- `SUPABASE_SERVICE_ROLE_KEY` is named as an **existing** deployment secret, not
  a new one to create; nothing here reads or reveals its value.
