import { test, type Page, type Route } from '@playwright/test';

/*
 * Shared rig for the auth-smoke suites.
 *
 * Both files here drive real auth-js against a Supabase-configured bundle
 * (scripts/build-auth-smoke.mjs) with only GoTrue's endpoints fulfilled
 * locally, so the fixtures and the stub live in one place rather than being
 * copied and left to drift.
 */

export const USER_ID = '5d2b6f10-7c4a-4a1e-9a3f-000000000001';
export const RECOVERY_EMAIL = 'owner@xbar.test';

// The tab-local marker the store writes alongside its in-memory flag. Read
// directly so the assertions can tell "the screen is correct" apart from "the
// grant never cleared, so of course it did not refuse" -- the success case is
// only meaningful if the grant really is gone underneath it.
export const RECOVERY_KEY = 'xbar-password-recovery-for';
export const RECOVERY_GRANT_KEY = 'xbar-password-recovery-grant';

/*
 * The durable, cross-tab record of grants that are over. Shared rather than
 * tab-local, because the tab that ends a recovery is often not the tab holding
 * it -- and a tab that was unloaded at the time has nowhere else to learn of it.
 */
export const RECOVERY_SPENT_KEY = 'xbar-password-recovery-spent';

/*
 * One key per account rather than one shared list, so two tabs revoking
 * different accounts at the same time cannot overwrite each other. 'spent'
 * means the grant is over; 'active' says a new link has been validated since,
 * and overrides an entry inherited from the older shared list.
 */
export const recoverySpentKeyFor = (userId: string) => `${RECOVERY_SPENT_KEY}:user:${userId}`;
export const recoveryUpdateClaimKeyFor = (userId: string) => `${RECOVERY_SPENT_KEY}:updating:user:${userId}`;

export function base64url(value: object) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

/*
 * A recovery link's access token. The signature is not real and does not need
 * to be: nothing in the browser verifies it -- GoTrue does, and GoTrue is
 * exactly what these tests stand in for. The claims are real because auth-js
 * reads them.
 */
let sessionSequence = 0;

export function accessToken(sessionId = 'auth-smoke-session') {
  const now = Math.floor(Date.now() / 1000);
  return [
    base64url({ alg: 'HS256', typ: 'JWT' }),
    base64url({
      sub: USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: RECOVERY_EMAIL,
      iat: now,
      exp: now + 3600,
      session_id: sessionId,
    }),
    'auth-smoke-unsigned',
  ].join('.');
}

/*
 * What Supabase puts in a recovery email: the implicit flow returns the session
 * in the URL FRAGMENT, and `type` is what tells auth-js which event to emit.
 * 'recovery' produces PASSWORD_RECOVERY; anything else is an ordinary sign-in,
 * which is the difference this screen has to act on.
 */
export function sessionLink(type: 'recovery' | 'signin') {
  const sessionId = `auth-smoke-${type}-${Date.now().toString(36)}-${(sessionSequence += 1).toString(36)}`;
  const fragment = new URLSearchParams({
    access_token: accessToken(sessionId),
    refresh_token: `${sessionId}-refresh-token`,
    expires_in: '3600',
    token_type: 'bearer',
    ...(type === 'recovery' ? { type: 'recovery' } : {}),
  });
  return `/app/reset-password#${fragment.toString()}`;
}

export const recoveryLink = () => sessionLink('recovery');

export function userRecord() {
  const stamp = new Date().toISOString();
  return {
    id: USER_ID,
    aud: 'authenticated',
    role: 'authenticated',
    email: RECOVERY_EMAIL,
    email_confirmed_at: stamp,
    phone: '',
    confirmed_at: stamp,
    last_sign_in_at: stamp,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: stamp,
    updated_at: stamp,
  };
}

/*
 * Stands in for GoTrue's /auth/v1/user, and only that.
 *
 * GET is how auth-js turns the token in the fragment into a session user, so
 * without it no recovery link can ever be accepted. PUT is the password change
 * itself -- the call that did not exist before this work, and the one whose
 * success clears the grant.
 */
export async function stubGoTrueUser(page: Page, onUpdate?: (route: Route) => Promise<void>) {
  await page.route('**/auth/v1/user*', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userRecord()) });
      return;
    }
    if (method === 'PUT') {
      if (onUpdate) {
        await onUpdate(route);
        return;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(userRecord()) });
      return;
    }
    await route.fallback();
  });
}

/*
 * The webfont stylesheet is not under test, and waiting on it is not free: the
 * document's load event blocks behind it, so on a network that neither serves
 * nor promptly refuses fonts.googleapis.com every navigation here paid ~25s
 * before a single assertion ran. Cutting it makes the suite depend on nothing
 * outside this machine. Registered on the CONTEXT so it also covers pages
 * opened mid-test; per-page auth routes still take precedence.
 */
export const blockWebfonts = () =>
  test.beforeEach(async ({ context }) => {
    await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort());
  });
