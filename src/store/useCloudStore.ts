import { create } from 'zustand';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { loadWorkspaceAccessProfile } from '@/lib/cloudWorkspace';
import { authStorageKey, getSupabaseClient } from '@/lib/supabaseClient';
import { mayRejoinDurableStore, readAuthStorage } from '@/lib/authStorage';
import {
  buildPasswordUpdateRequest,
  readPasswordUpdateError,
  runPasswordUpdateWithLock,
} from '@/lib/passwordUpdateRequest';
import { supabaseConfig } from '@/lib/platformConfig';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import type { UserRole } from '@/types/xbar';
import { authCallbackOrigin, isNativeApp } from '../lib/nativePlatform.js';
import { describeAuthError } from '@/lib/authErrors';
import {
  bootstrapEventDisposition,
  createLatestWriteGate,
  identityPublication,
  liveSessionAgrees,
  reconcilePublishedSession,
  waitForStorageCatchUp,
  type StorageCatchUp,
} from '@/lib/authBootstrap';
import { hasValidatedPasswordRecovery as recoveryGateOpen, reconcileStoredRecovery } from '@/lib/passwordRecovery';
import { authRedirectUrl, passwordResetPath, publicAppRouteUrl } from '@/lib/routeCanon';

type CloudActionResult = {
  ok: boolean;
  message: string;
  /*
   * Set when the request may ALREADY HAVE BEEN APPLIED -- an aborted PUT, or a
   * gateway failure after GoTrue may have accepted it. `ok: false` alone cannot
   * carry that: it reads as a refusal, and the reset screen drew the
   * expired-link warning beside "we could not confirm", telling the customer
   * both that the link is spent and that they should try the new password.
   *
   * A flag rather than a message match, because the screen keying off prose is
   * how the two fall out of step the first time either is reworded.
   */
  uncertain?: boolean;
};

/*
 * What a signup actually did, which is not knowable from `error` alone.
 *
 * Supabase deliberately does not fail a signup for an already-registered
 * address: it returns "an obfuscated user response with no verification email
 * sent" so an attacker cannot enumerate accounts. The app read only `error`,
 * so that silence arrived here as success and the screen said "Account created.
 * Check your inbox" about an email that was never sent. Every locked-out
 * customer who then waited for it was waiting on our claim, not on Supabase.
 */
type SignUpOutcome =
  | 'signed-in' // Autoconfirm is on; there is a session and nothing to confirm.
  | 'confirmation-required' // A new account exists and Supabase sent the email.
  | 'existing-account'; // Nothing was created and nothing was sent.

type CloudSignUpResult = CloudActionResult & {
  outcome?: SignUpOutcome;
};

type CloudStatus = 'unavailable' | 'loading' | 'signed-out' | 'signed-in';
type CloudSyncState = 'idle' | 'syncing' | 'error';

type CloudStore = {
  initialized: boolean;
  status: CloudStatus;
  /*
   * Whether WHO is signed in has settled for this page load -- a different
   * question from whether their workspace has loaded.
   *
   * `status` answers both at once: it stays 'loading' until the workspace
   * profile resolves, because that is when the app may render records. The
   * reset screen does not need records; it needs to know whether a recovery
   * link established a session. Reading `status` there made a validated
   * recovery wait on unrelated PostgREST queries against `workspaces`, so with
   * relational sync on (the production default) and that endpoint slow or
   * down, someone holding a good link waited indefinitely -- and a reload
   * repeated it -- while GoTrue was healthy enough to change the password.
   *
   * Published as soon as the auth event or the bootstrap says who is here.
   * Never a permission: `status` still gates the app, and the recovery form
   * still requires a session whose user matches the grant.
   */
  authReady: boolean;
  /*
   * Whether the workspace profile for the CURRENT session has resolved.
   *
   * `session` now lands before that profile, so anything acting on a workspace
   * -- hydration, vault promotion -- waits for this rather than for a session
   * to appear, or it starts against an empty workspace id and runs again when
   * the real one arrives.
   */
  workspaceReady: boolean;
  session: Session | null;
  workspaceId: string;
  workspaceRole: UserRole;
  lastSyncAt: string;
  syncState: CloudSyncState;
  syncMessage: string;
  autosaveReady: boolean;
  /*
   * Whether reconciliation actually SETTLED on a copy, as opposed to merely
   * finishing.
   *
   * `autosaveReady` turns true on every path out of CloudBootstrap, including
   * `conflict-lock` and a failed remote load — it means "no longer hydrating",
   * not "the records on screen are this workspace's". Anything that acts on the
   * store's contents as if they belong to the signed-in workspace has to wait
   * for this one instead, and the vault sweep is the case where reading the
   * wrong one deletes a rancher's only copy of a document.
   */
  autosaveUnlocked: boolean;
  initialize: () => Promise<(() => void) | void>;
  setLastSyncAt: (value: string) => void;
  setSyncState: (state: CloudSyncState, message?: string) => void;
  setWorkspaceAccessProfile: (workspaceId: string, workspaceRole?: UserRole) => void;
  // Both arguments are required so a new call site cannot quietly inherit the
  // permissive half of this pair.
  setAutosaveReady: (ready: boolean, unlocked: boolean) => void;
  /*
   * The rancher resolved a `conflict-lock` by hand, choosing a copy with Push
   * cloud or Pull cloud in Settings.
   *
   * Reconciliation is the only other thing that unlocks autosave, and it runs
   * once per hydration: its effect is keyed on the workspace and the session,
   * neither of which changes when someone presses a button in Settings. So
   * without this, resolving the conflict left autosave locked until a reload —
   * while the toast said the sync had completed.
   *
   * A named transition rather than a second argument to `setAutosaveReady`,
   * for the reason given above it: a call site that can pass `ready` is a call
   * site that can promote a half-hydrated workspace. This one cannot. It
   * refuses while hydration is still running, because `finish` is authoritative
   * about which copy won and would overwrite this a moment later anyway.
   */
  unlockAutosaveAfterManualSync: () => void;
  signInWithPassword: (email: string, password: string) => Promise<CloudActionResult>;
  sendMagicLink: (email: string) => Promise<CloudActionResult>;
  /**
   * Email a one-time CODE, and verify it in place.
   *
   * Distinct from sendMagicLink, and the distinction is the whole point on
   * native. A magic link signs the customer in wherever the link opens, which
   * is a browser -- so it cannot deliver a session into the app. A code is
   * typed into the app and exchanged there, which is why it is the only
   * emailed route that actually gets an account INTO a store build.
   */
  sendEmailCode: (email: string) => Promise<CloudActionResult>;
  verifyEmailCode: (email: string, code: string) => Promise<CloudActionResult>;
  signUpWithPassword: (email: string, password: string) => Promise<CloudSignUpResult>;
  resendSignUpConfirmation: (email: string) => Promise<CloudActionResult>;
  updatePassword: (password: string) => Promise<CloudActionResult>;
  /*
   * The user id Supabase validated a recovery link FOR, or '' for none.
   *
   * A bare boolean was wrong: it said a recovery was in progress without
   * saying whose, so it outlived the session it was granted for. If that
   * session ended -- an expired token, a sign-out in another tab -- the flag
   * stayed set, and the next ordinary sign-in in this tab inherited it and
   * could change THAT account's password with no recovery ever validated.
   *
   * Carrying the id makes the mismatch unrepresentable: authorization is only
   * ever compared against the session actually holding it.
   */
  passwordRecoveryFor: string;
  /**
   * The grant id that authorization was recorded under.
   *
   * Kept in the store rather than read from sessionStorage where it is needed,
   * because the reset screen subscribes to this: a session replaced by an
   * ordinary sign-in leaves `passwordRecoveryFor` untouched, so the grant is
   * the only part of the state that changes, and a selector that reads it out
   * of band would not re-render on it.
   */
  passwordRecoveryGrant: string;
  sendPasswordReset: (email: string) => Promise<CloudActionResult>;
  signInWithFacebook: () => Promise<CloudActionResult>;
  signInWithGoogle: () => Promise<CloudActionResult>;
  signInWithApple: () => Promise<CloudActionResult>;
  signOut: () => Promise<CloudActionResult>;
  deleteAccount: (confirmation: string) => Promise<CloudActionResult>;
};

/*
 * Where an emailed auth link should send the customer back to.
 *
 * Every magic link, signup confirmation and password reset is built from this,
 * and on the web the current page is exactly right.
 *
 * Inside a store build it is not. The page origin there is
 * `capacitor://localhost` — a scheme no email client can open and that Supabase
 * will not accept as a redirect — so every one of those emails arrived with a
 * dead link. Signup could not be completed at all where email confirmation is
 * required, and the visible "Forgot password?" action sent a link that goes
 * nowhere. Both are broken features in their own right and rejections under
 * Guideline 2.1.
 *
 * `authCallbackOrigin()` returns the configured public site in a store build,
 * which at least lands the customer somewhere real. It signs them in on the web
 * rather than in the app, which is why the one-time code path exists: a code is
 * verified in-app and needs no callback at all. It returns undefined when there
 * is nothing sensible to use, which tells the Supabase client to fall back to
 * the project's configured Site URL rather than to a scheme it will reject.
 */
function currentAuthRedirectUrl() {
  const nativeOrigin = authCallbackOrigin();
  if (isNativeApp()) return nativeOrigin;
  return typeof window !== 'undefined'
    ? `${window.location.origin}${window.location.pathname}${window.location.search}`
    : undefined;
}

/*
 * A validated recovery has to survive a page refresh.
 *
 * auth-js clears the callback fragment once it has validated the link and
 * persists the resulting session, so a reload arrives with a perfectly good
 * recovery session and only an INITIAL_SESSION event. Held in memory alone,
 * the authorization vanished there and the customer was told their valid link
 * had expired.
 *
 * sessionStorage rather than localStorage: this is a one-time flow, and it
 * should not outlive the tab. What is stored is the user id, never a token, so
 * it grants nothing on its own -- it is only ever compared against the session
 * Supabase itself established, and a mismatch authorizes nothing.
 */
const RECOVERY_USER_KEY = 'xbar-password-recovery-for';
const RECOVERY_GRANT_KEY = 'xbar-password-recovery-grant';

/*
 * The tab-local grant is durable across a reload, so its revocation has to be
 * too. USER_UPDATED is a transient broadcast: a tab that was reloading while
 * another tab finished the reset never hears it. localStorage rather than
 * sessionStorage precisely because it must outlive the tab and be visible to
 * every one of them. What is stored is a user id, never a token.
 */
const RECOVERY_SPENT_KEY = 'xbar-password-recovery-spent';
const RECOVERY_SPENT_USER_PREFIX = `${RECOVERY_SPENT_KEY}:user:`;
const RECOVERY_UPDATE_CLAIM_PREFIX = `${RECOVERY_SPENT_KEY}:updating:user:`;
const RECOVERY_UPDATE_CLAIM_TTL_MS = 2 * 60 * 1000;
const RECOVERY_UPDATE_CLAIM_RENEW_MS = 1000;
const RECOVERY_UPDATE_CLAIM_SETTLE_MS = 50;
const RECOVERY_UPDATE_LOCK_PREFIX = 'xbar-password-recovery-update:';

type RecoveryUserState = 'spent' | 'active';

type StoredRecoveryUserMarker = {
  state: RecoveryUserState;
  grantToken?: string;
  /*
   * Which derivation the grantToken came from.
   *
   * b84379e briefly wrote markers whose grantToken hashed the ACCESS TOKEN,
   * which a refresh changes. Those ids can never match one derived the current
   * way, so a 'spent' marker left over from that build would compare unequal
   * and read as "not spent" -- a used link looking unused. They cannot be told
   * apart by shape, so they are told apart by this version being absent, and an
   * unversioned 'spent' is honoured for the whole account: strict, and cleared
   * again the moment a new link is validated.
   */
  version?: number;
};

const RECOVERY_MARKER_VERSION = 2;

type RecoveryUpdateClaim = {
  userId: string;
  grantToken: string;
  token: string;
};

type RecoveryUpdateClaimResult =
  { ok: true; claim: RecoveryUpdateClaim } | { ok: false; reason: 'busy' | 'spent' | 'unavailable' };

type StoredRecoveryUpdateClaim = {
  token: string;
  expiresAt: number;
  grantToken?: string;
};

function stableRecoveryGrantId(seed: string): string {
  if (!seed) return '';
  let primary = 2166136261;
  let secondary = 0x9e3779b9;
  for (let index = 0; index < seed.length; index += 1) {
    const code = seed.charCodeAt(index);
    primary ^= code;
    primary = Math.imul(primary, 16777619) >>> 0;
    secondary ^= code + index;
    secondary = Math.imul(secondary, 1597334677) >>> 0;
  }
  return `${seed.length.toString(36)}-${primary.toString(36)}-${secondary.toString(36)}`;
}

function decodeJwtClaims(accessToken = ''): Record<string, unknown> {
  try {
    const payload = accessToken.split('.')[1];
    if (!payload || typeof atob === 'undefined') return {};
    const padded = payload
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(payload.length / 4) * 4, '=');
    const parsed = JSON.parse(atob(padded));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/*
 * Which reset link a grant came from -- or nothing, if the token cannot say.
 *
 * `session_id` is the only claim with the right lifetime: the access token
 * rotates whenever auth-js refreshes (supabaseClient.ts enables
 * autoRefreshToken) and GoTrue rotates the refresh token with it, so anything
 * derived from the credential drifts mid-recovery. `session_id` survives that
 * and changes when a new link is issued.
 *
 * The fallback is deliberately NOTHING rather than a fingerprint of `iat`/
 * `exp`, which are exactly the claims a refresh changes: an identifier that
 * drifts is worse than no identifier at all, because a record of what was
 * consumed stops matching and a spent link starts reading as unused. With no
 * id the grant is handled account-wide instead -- consumption revokes every
 * grant for that account and a completion is never narrowed to a link nobody
 * can name. That is stricter than the per-link path, never looser, which is
 * the direction to fail in. Every GoTrue token issued by a recovery link
 * carries `session_id`; this is the answer for tokens that somehow do not.
 */
/*
 * The claim two access tokens share when one is a refresh of the other.
 */
function sessionGenerationOf(session: { access_token?: string } | null): string {
  if (!session?.access_token) return '';
  const claim = decodeJwtClaims(session.access_token).session_id;
  return typeof claim === 'string' ? claim : '';
}

function recoveryGrantToken(session: Session | null): string {
  if (!session) return '';
  const claims = decodeJwtClaims(session.access_token);
  const sessionId = typeof claims.session_id === 'string' ? claims.session_id : '';
  if (!sessionId) return '';
  const subject = typeof claims.sub === 'string' ? claims.sub : session.user.id;
  return stableRecoveryGrantId(`${subject}:${sessionId}`);
}

/*
 * Where the recovery records live, and what happens when they cannot.
 *
 * localStorage is the right home for them: they must outlive a reload and be
 * visible to every tab. It is not always available. Blocked site data, a full
 * quota and some private modes make it absent, or make every access THROW
 * rather than return null.
 *
 * auth-js falls back to an in-memory adapter in exactly that case and still
 * establishes a perfectly valid recovery session -- so refusing here stopped a
 * customer with blocked storage from resetting their password at all, even
 * with a real Web Lock held. A protection causing the lockout it exists to
 * prevent.
 *
 * So it degrades rather than refuses: the same records, kept for the life of
 * the page. Stated plainly, because the difference matters --
 *
 *   what this still gives  one completion per grant in this tab, and, since
 *                          the spent broadcast uses no storage at all, other
 *                          OPEN tabs still hear it.
 *   what it cannot give    nothing survives a reload. A reloaded tab has no
 *                          record that the grant was spent, and without Web
 *                          Locks there is no exclusion either. Best effort,
 *                          which is better than a lockout and is not a
 *                          guarantee.
 *
 * Writes go to memory FIRST and always, so a write localStorage rejects -- a
 * full quota is the common one -- still counts for this page.
 */
/*
 * Present only for keys the durable store could NOT be updated with, and then
 * memory is the sole truth for that key. `null` is a removal that did not
 * persist.
 *
 * Shadowing every write instead was wrong in a way that mattered: with
 * localStorage readable but its writes failing -- a full quota, which is the
 * common shape -- a read preferred the older PERSISTED value over the newer
 * one in memory. An expired update claim could then never be replaced. The new
 * claim reached memory only, the settle re-read returned the stale token, and
 * the link reported "already being used in another tab" on every attempt,
 * forever.
 */
const memoryRecoveryRecords = new Map<string, string | null>();

/*
 * What localStorage held when a recovery key first fell into the overlay.
 *
 * The same hazard as the auth session store, and the same repair -- see
 * `mayRejoinDurableStore` in lib/authStorage.ts, whose comment carries the
 * measured trace. A key lands in the overlay only because a durable write was
 * REFUSED, and from that instant this tab is effectively private for it while
 * still believing it shares one. Rejoining blindly once storage recovers lets
 * this tab overwrite what the other tabs wrote meanwhile.
 *
 * For recovery records that is worse than a stale read. A tab whose marker
 * write was refused, signing out grant A after another tab has durably
 * validated grant B, would replace `active:B` with the account-wide `spent`
 * marker -- and B's unused link then reports as already used, with no way back
 * except another email. The link is one-time, so there is no recovering it.
 */
const recoveryRecordsDivergedAt = new Map<string, string | null>();

function readDurableRecoveryRecord(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
  } catch {
    // Blocked site data throws on access rather than returning null.
  }
  return null;
}

/* Records the divergence once; a later anchor would point at another tab's write. */
function markRecoveryRecordDiverged(key: string) {
  if (recoveryRecordsDivergedAt.has(key)) return;
  recoveryRecordsDivergedAt.set(key, readDurableRecoveryRecord(key));
}

function mayRejoinRecoveryRecords(key: string): boolean {
  if (!recoveryRecordsDivergedAt.has(key)) return true;
  return mayRejoinDurableStore(recoveryRecordsDivergedAt.get(key), readDurableRecoveryRecord(key));
}

function recoveryRecordGet(key: string): string | null {
  // The overlay outranks the durable store: it exists only where the durable
  // store is known to be behind.
  if (memoryRecoveryRecords.has(key)) return memoryRecoveryRecords.get(key) ?? null;
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
  } catch {
    // Blocked site data throws on access rather than returning null.
  }
  return null;
}

function recoveryRecordSet(key: string, value: string) {
  // Diverged and the durable record has moved on: stay private rather than
  // overwrite a grant another tab validated meanwhile.
  if (!mayRejoinRecoveryRecords(key)) {
    memoryRecoveryRecords.set(key, value);
    return;
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
      // Durable and readable by every tab; the overlay would only go stale.
      memoryRecoveryRecords.delete(key);
      recoveryRecordsDivergedAt.delete(key);
      return;
    }
  } catch {
    // Falls through to the overlay.
  }
  markRecoveryRecordDiverged(key);
  memoryRecoveryRecords.set(key, value);
}

function recoveryRecordRemove(key: string) {
  if (!mayRejoinRecoveryRecords(key)) {
    memoryRecoveryRecords.set(key, null);
    return;
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
      memoryRecoveryRecords.delete(key);
      recoveryRecordsDivergedAt.delete(key);
      return;
    }
  } catch {
    // Falls through to a tombstone, so the stale persisted value does not
    // reappear as though the removal never happened.
  }
  markRecoveryRecordDiverged(key);
  memoryRecoveryRecords.set(key, null);
}

function recoveryRecordKeys(): string[] {
  const keys = new Set<string>();
  try {
    if (typeof localStorage !== 'undefined') for (const key of Object.keys(localStorage)) keys.add(key);
  } catch {
    // Overlay-only, then.
  }
  for (const [key, value] of memoryRecoveryRecords) {
    if (value === null) keys.delete(key);
    else keys.add(key);
  }
  return [...keys];
}

function normalizeRecoveryUsers(users: Iterable<unknown>): string[] {
  return [...new Set([...users].filter((user): user is string => typeof user === 'string' && user.length > 0))].sort();
}

function readLegacySpentRecoveryUsers(): string[] {
  try {
    const raw = recoveryRecordGet(RECOVERY_SPENT_KEY) ?? '';
    let legacyUsers = raw ? [raw] : [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) legacyUsers = normalizeRecoveryUsers(parsed);
        else if (parsed && typeof parsed === 'object') legacyUsers = normalizeRecoveryUsers(Object.keys(parsed));
      } catch {
        // Older builds stored one bare user id. Treat it as one revoked grant.
      }
    }
    return normalizeRecoveryUsers(legacyUsers);
  } catch {
    return [];
  }
}

function parseRecoveryUserMarker(raw: string | null): StoredRecoveryUserMarker | null {
  if (raw === 'spent' || raw === 'active') return { state: raw };
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredRecoveryUserMarker>;
    if (parsed.state !== 'spent' && parsed.state !== 'active') return null;
    const versioned = parsed.version === RECOVERY_MARKER_VERSION;
    return {
      state: parsed.state,
      // An unversioned grantToken is from the access-token derivation and
      // cannot be compared with today's; dropping it makes the marker apply to
      // the whole account, which is the safe reading of "already spent".
      ...(versioned && typeof parsed.grantToken === 'string' && parsed.grantToken
        ? { grantToken: parsed.grantToken, version: parsed.version }
        : {}),
    };
  } catch {
    return null;
  }
}

function readRecoveryUserMarker(userId: string): StoredRecoveryUserMarker | null {
  try {
    if (!userId) return null;
    return parseRecoveryUserMarker(recoveryRecordGet(`${RECOVERY_SPENT_USER_PREFIX}${userId}`));
  } catch {
    return null;
  }
}

function recoveryMarkerAppliesToGrant(marker: StoredRecoveryUserMarker, grantToken: string) {
  return !marker.grantToken || !grantToken || marker.grantToken === grantToken;
}

/*
 * One key per consumed grant, kept forever, alongside the single per-account
 * marker rather than instead of it.
 *
 * The per-account marker is one slot, so it only ever remembers the LAST thing
 * that happened to the account -- and 'spent' bound to grant B does not reject
 * grant A. A tab holding A, unloaded while B was validated and then spent, came
 * back to a marker that no longer said anything about A and could change the
 * password with no new link. Revocations have to accumulate, because a grant
 * that is over never becomes valid again.
 *
 * The account marker keeps its own job: a sign-out ends EVERY grant for the
 * account, which no per-grant record can express, and a newly validated link
 * clears it.
 */
function recoverySpentGrantKey(userId: string, grantToken: string) {
  return `${RECOVERY_SPENT_KEY}:grant:${userId}:${grantToken}`;
}

function recordSpentRecoveryGrant(userId: string, grantToken: string) {
  if (!userId || !grantToken) return;
  try {
    recoveryRecordSet(recoverySpentGrantKey(userId, grantToken), 'spent');
  } catch {
    // Non-fatal; the account marker and the live release still apply.
  }
}

function isSpentRecoveryGrant(userId: string, grantToken: string) {
  if (!userId || !grantToken) return false;
  try {
    return recoveryRecordGet(recoverySpentGrantKey(userId, grantToken)) === 'spent';
  } catch {
    return false;
  }
}

function isRecoveryGrantSpent(userId: string, grantToken: string): boolean {
  if (!userId) return false;
  try {
    // Accumulated, so an earlier grant stays revoked after a later one is
    // validated and spent. The single account marker below cannot hold that.
    if (isSpentRecoveryGrant(userId, grantToken)) return true;
    const marker = readRecoveryUserMarker(userId);
    if (marker?.state === 'active') return !recoveryMarkerAppliesToGrant(marker, grantToken);
    if (marker?.state === 'spent') return recoveryMarkerAppliesToGrant(marker, grantToken);
    return readLegacySpentRecoveryUsers().includes(userId);
  } catch {
    return false;
  }
}

function readSpentRecoveryUsers(): string[] {
  try {
    const spent = new Set(readLegacySpentRecoveryUsers());
    for (const key of recoveryRecordKeys()) {
      if (!key.startsWith(RECOVERY_SPENT_USER_PREFIX)) continue;
      const userId = key.slice(RECOVERY_SPENT_USER_PREFIX.length);
      const marker = parseRecoveryUserMarker(recoveryRecordGet(key));
      if (marker?.state === 'spent') spent.add(userId);
      else if (marker?.state === 'active') spent.delete(userId);
    }
    return normalizeRecoveryUsers(spent);
  } catch {
    return [];
  }
}

function writeRecoveryUserState(userId: string, state: RecoveryUserState, grantToken = '') {
  if (!userId) return;
  try {
    /*
     * One atomic write per account: concurrent writers for different accounts
     * cannot replace each other's revocations. When we know the specific link,
     * bind the marker to that link so an older completion cannot burn a newer
     * reset email for the same account.
     */
    recoveryRecordSet(
      `${RECOVERY_SPENT_USER_PREFIX}${userId}`,
      grantToken ? JSON.stringify({ state, grantToken, version: RECOVERY_MARKER_VERSION }) : state,
    );
  } catch {
    // Non-fatal; the transient event still clears live tabs.
  }
}

function recordSpentRecoveryUser(userId: string, grantToken = '') {
  writeRecoveryUserState(userId, 'spent', grantToken);
}

/*
 * A newly validated link ends the one it replaces.
 *
 * The account marker holds ONE generation, so writing `active:<new>` over
 * `active:<old>` was the only record the old generation had. While the marker
 * still said `active:<new>`, the old grant did read as revoked -- but the
 * moment the new one was spent the marker became `spent:<new>`, which says
 * nothing about the old grant, and it CAME BACK TO LIFE. A tab still holding
 * it, reloaded against any ordinary session for the same account, could then
 * change the password with no current link -- exactly what this gate exists to
 * prevent.
 *
 * The accumulated per-grant keys were only ever written for a grant that was
 * consumed. A grant that is displaced is just as over, so it is written here
 * too, before the marker forgets it. Those keys accumulate; the marker cannot.
 */
function supersedeRecoveryGeneration(userId: string, grantToken = '') {
  const displaced = readRecoveryUserMarker(userId);
  if (displaced?.grantToken && displaced.grantToken !== grantToken) {
    recordSpentRecoveryGrant(userId, displaced.grantToken);
  }
  writeRecoveryUserState(userId, 'active', grantToken);
}

function recoveryUpdateClaimKey(userId: string) {
  return `${RECOVERY_UPDATE_CLAIM_PREFIX}${userId}`;
}

function newRecoveryUpdateClaimToken() {
  const randomUUID = globalThis.crypto?.randomUUID;
  return typeof randomUUID === 'function'
    ? randomUUID.call(globalThis.crypto)
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function readRecoveryUpdateClaim(userId: string): StoredRecoveryUpdateClaim | null {
  try {
    const raw = recoveryRecordGet(recoveryUpdateClaimKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredRecoveryUpdateClaim>;
    if (typeof parsed.token !== 'string' || typeof parsed.expiresAt !== 'number') return null;
    return {
      token: parsed.token,
      expiresAt: parsed.expiresAt,
      ...(typeof parsed.grantToken === 'string' && parsed.grantToken ? { grantToken: parsed.grantToken } : {}),
    };
  } catch {
    return null;
  }
}

function writeRecoveryUpdateClaim(claim: RecoveryUpdateClaim) {
  recoveryRecordSet(
    recoveryUpdateClaimKey(claim.userId),
    JSON.stringify({
      token: claim.token,
      grantToken: claim.grantToken,
      expiresAt: Date.now() + RECOVERY_UPDATE_CLAIM_TTL_MS,
    }),
  );
}

function clearRecoveryUpdateClaim(claim: RecoveryUpdateClaim) {
  try {
    const current = readRecoveryUpdateClaim(claim.userId);
    if (current?.token === claim.token) recoveryRecordRemove(recoveryUpdateClaimKey(claim.userId));
  } catch {
    // Non-fatal; the short TTL retires stale claims.
  }
}

function completeRecoveryUpdateClaim(claim: RecoveryUpdateClaim) {
  /*
   * Both records, because they answer different questions. The per-grant one
   * is permanent and specific -- THIS link is over, and stays over however many
   * links follow it. The account marker keeps the fast path and the legacy
   * shape working.
   *
   * A grant with no identifier is recorded account-wide instead, which is the
   * conservative direction: an unidentifiable link ends every grant for that
   * account rather than none. See recoveryGrantToken on when that happens.
   */
  recordSpentRecoveryGrant(claim.userId, claim.grantToken);

  /*
   * The account marker moves only if it still names THIS claim.
   *
   * It holds one generation, and an update that finishes after a newer link
   * has been validated would otherwise replace `active:B` with `spent:A`. The
   * immediate harm is nil -- B's own grant id still differs, so B's form
   * survives -- but B's displacement is then unrecorded anywhere: spending a
   * later link C revokes only A and C, and an unloaded tab still holding B can
   * restore its authorization against an ordinary same-account session.
   *
   * The permanent per-grant record above is unconditional, so A stays spent
   * either way. This only decides what the single account slot says.
   */
  const marker = readRecoveryUserMarker(claim.userId);
  if (!marker?.grantToken || marker.grantToken === claim.grantToken) {
    recordSpentRecoveryUser(claim.userId, claim.grantToken);
  }
  clearRecoveryUpdateClaim(claim);
}

function renewRecoveryUpdateClaim(claim: RecoveryUpdateClaim): boolean {
  try {
    const current = readRecoveryUpdateClaim(claim.userId);
    if (current?.token !== claim.token) return false;
    writeRecoveryUpdateClaim(claim);
    return true;
  } catch {
    return false;
  }
}

function startRecoveryUpdateClaimRenewal(claim: RecoveryUpdateClaim) {
  try {
    const interval = setInterval(() => {
      if (!renewRecoveryUpdateClaim(claim)) clearInterval(interval);
    }, RECOVERY_UPDATE_CLAIM_RENEW_MS);
    return () => clearInterval(interval);
  } catch {
    return () => {};
  }
}

/*
 * Real mutual exclusion, where the browser has it.
 *
 * The durable claim below is best effort and cannot be made otherwise:
 * localStorage has no compare-and-set, so write-yield-re-read narrows the race
 * without closing it -- a tab that pauses after reading "absent" and resumes
 * after the other tab's settle window still acquires an apparent ownership of
 * its own. A Web Lock is therefore required for this mutation. Browsers without
 * it (including safari13) can use the app but cannot complete password reset;
 * lock acquisition errors also refuse instead of using a timing fallback.
 *
 * This is OUR lock name and nothing from auth-js runs inside it, which is what
 * makes it safe here: the deadlock that came before was auth-js's own
 * `_acquireLock` re-entered by a nested public method, not Web Locks as such.
 *
 * `ifAvailable` rather than queueing, so a second tab is told the link is in
 * use instead of sitting on "Saving..." behind a request it cannot see.
 */
async function withRecoveryUpdateExclusion<T>(
  userId: string,
  run: () => Promise<T>,
  busy: () => T,
  unavailable: () => T,
): Promise<T> {
  let locks: LockManager | undefined;
  try {
    locks = globalThis.navigator?.locks;
  } catch {
    return unavailable();
  }
  if (!locks) return unavailable();
  const manager = locks;
  return runPasswordUpdateWithLock(
    run,
    async (work) =>
      await manager.request(`${RECOVERY_UPDATE_LOCK_PREFIX}${userId}`, { ifAvailable: true }, async (lock) =>
        lock ? work() : busy(),
      ),
    unavailable,
  );
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function claimRecoveryUpdate(userId: string, grantToken: string): Promise<RecoveryUpdateClaimResult> {
  if (!userId) return { ok: false, reason: 'unavailable' };
  try {
    if (isRecoveryGrantSpent(userId, grantToken)) return { ok: false, reason: 'spent' };

    const existing = readRecoveryUpdateClaim(userId);
    if (existing && existing.expiresAt > Date.now()) return { ok: false, reason: 'busy' };

    const claim = {
      userId,
      grantToken,
      token: newRecoveryUpdateClaimToken(),
    };
    writeRecoveryUpdateClaim(claim);

    /*
     * localStorage has atomic reads and writes, not an atomic "set if absent".
     * Yield once so racing tabs can overwrite each other before anyone sends a
     * password request; only the token still present after the settle window
     * owns the claim.
     */
    await delay(RECOVERY_UPDATE_CLAIM_SETTLE_MS);

    const owned = readRecoveryUpdateClaim(userId);
    if (owned?.token !== claim.token) return { ok: false, reason: 'busy' };
    if (isRecoveryGrantSpent(userId, grantToken)) {
      clearRecoveryUpdateClaim(claim);
      return { ok: false, reason: 'spent' };
    }
    return { ok: true, claim };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

function readStoredRecoveryUser(): string {
  try {
    return typeof sessionStorage === 'undefined' ? '' : (sessionStorage.getItem(RECOVERY_USER_KEY) ?? '');
  } catch {
    // Private modes and blocked site data throw on access rather than return
    // null; losing the marker costs a re-request, so it must never throw here.
    return '';
  }
}

function readStoredRecoveryGrantToken(): string {
  try {
    return typeof sessionStorage === 'undefined' ? '' : (sessionStorage.getItem(RECOVERY_GRANT_KEY) ?? '');
  } catch {
    return '';
  }
}

function reconcileStoredRecoveryGrant(storedGrant: string, grantToken: string) {
  if (!grantToken) return reconcileStoredRecovery({ storedGrant, spentFor: readSpentRecoveryUsers() });
  return reconcileStoredRecovery({
    storedGrant,
    spentFor: isRecoveryGrantSpent(storedGrant, grantToken) ? storedGrant : '',
  });
}

function storeRecoveryUser(userId: string, grantToken = '') {
  try {
    if (typeof sessionStorage === 'undefined') return;
    if (userId) {
      sessionStorage.setItem(RECOVERY_USER_KEY, userId);
      if (grantToken) sessionStorage.setItem(RECOVERY_GRANT_KEY, grantToken);
      else sessionStorage.removeItem(RECOVERY_GRANT_KEY);
    } else {
      sessionStorage.removeItem(RECOVERY_USER_KEY);
      sessionStorage.removeItem(RECOVERY_GRANT_KEY);
    }
  } catch {
    // Non-fatal: the in-memory flag still carries the current tab.
  }
}

/*
 * Our own cross-tab signal that a grant is spent.
 *
 * auth-js made this announcement for us as a side effect of updateUser
 * emitting USER_UPDATED. The mutation no longer goes through auth-js -- it
 * carries the validated token instead, so the correct-account invariant holds
 * without Web Locks -- so this module makes the announcement itself.
 */
const RECOVERY_CHANNEL = 'xbar-password-recovery';

function announceSpentRecovery(userId: string, grantToken = '') {
  try {
    if (typeof BroadcastChannel === 'undefined' || !userId) return;
    const channel = new BroadcastChannel(RECOVERY_CHANNEL);
    channel.postMessage({ type: 'recovery-spent', userId, grantToken });
    channel.close();
  } catch {
    // Non-fatal: the durable record still retires the grant on reload.
  }
}

function initialRecoveryGrantState(): { passwordRecoveryFor: string; passwordRecoveryGrant: string } {
  const grantToken = readStoredRecoveryGrantToken();
  const passwordRecoveryFor = reconcileStoredRecoveryGrant(readStoredRecoveryUser(), grantToken);
  // A reconciled-away grant leaves no id behind: the two must never disagree.
  return { passwordRecoveryFor, passwordRecoveryGrant: passwordRecoveryFor ? grantToken : '' };
}

/**
 * The reset screen's question, asked of the whole store.
 *
 * The decision itself stays pure in lib/passwordRecovery.ts; this only supplies
 * the two grant ids, one of which has to be derived from the live session.
 */
export function hasValidatedPasswordRecovery(state: {
  session: { user: { id: string }; access_token?: string } | null;
  passwordRecoveryFor: string;
  passwordRecoveryGrant: string;
}): boolean {
  return recoveryGateOpen({
    session: state.session,
    passwordRecoveryFor: state.passwordRecoveryFor,
    passwordRecoveryGrant: state.passwordRecoveryGrant,
    sessionGrant: recoveryGrantToken(state.session as Session | null),
  });
}

export const useCloudStore = create<CloudStore>((set, get) => ({
  initialized: false,
  authReady: false,
  workspaceReady: false,
  ...initialRecoveryGrantState(),
  status: isSupabaseConfigured() ? 'loading' : 'unavailable',
  session: null,
  workspaceId: '',
  workspaceRole: isSupabaseConfigured() ? 'Owner' : 'Admin',
  lastSyncAt: '',
  syncState: 'idle',
  syncMessage: '',
  autosaveReady: !isSupabaseConfigured(),
  // Same rule as `autosaveReady`: with no Supabase project there is no
  // reconciliation to wait for, and a local-only workspace must not be made to
  // wait for something that will never happen.
  autosaveUnlocked: !isSupabaseConfigured(),
  initialize: async () => {
    if (get().initialized) {
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      set({ initialized: true, status: 'unavailable', session: null, workspaceId: '', workspaceRole: 'Admin' });
      return;
    }

    /*
     * Only the most recent sync may write. These are started without being
     * awaited and they do not take the same time -- a signed-out sync writes
     * at once, a signed-in one first loads a workspace over the network -- so
     * without this the winner is whichever FINISHES last, and a sign-out gets
     * quietly undone by the sign-in it replaced. See lib/authBootstrap.ts.
     */
    const syncGate = createLatestWriteGate();

    /*
     * WHO is signed in, published without waiting for their workspace.
     *
     * Two callers, and the second is the point: the bootstrap sync uses this
     * before its profile round trip, and so does an event that arrives while
     * the bootstrap is still running and can only be QUEUED. Queuing the whole
     * event left the store describing an account that had already been
     * replaced -- `hasValidatedPasswordRecovery` went on matching it, so the
     * reset form stayed live for a session this browser no longer held.
     *
     * On an identity change the previous account's workspace state is retired
     * with it. Publishing the new session while leaving `status: 'signed-in'`,
     * the old `workspaceId` and the old role produced a HYBRID the app has no
     * honest reading of: RequireCloudAuth only holds on 'loading', so the
     * previous account's records stayed interactive under the new identity,
     * and a workspace-scoped write would have carried the old workspace id
     * with the new access token. Dropping back to 'loading' is the coherent
     * transition -- it says the one true thing, that who is here is known and
     * what they can see is not yet.
     *
     * The reset screen is unaffected by that: it settles on `authReady`, which
     * is exactly why these are separate flags.
     */
    const publishAuthIdentity = (session: Session | null) => {
      if (!session) {
        set({
          status: 'signed-out',
          authReady: true,
          workspaceReady: true,
          session: null,
          workspaceId: '',
          workspaceRole: 'Owner',
        });
        return;
      }

      set({
        session,
        authReady: true,
        ...identityPublication(get().session?.user.id ?? '', session.user.id),
      });
    };

    const syncSessionState = async (session: Session | null, initialized = false, reservedTicket?: () => boolean) => {
      /*
       * The bootstrap reserves its ticket BEFORE awaiting getSession and hands
       * it in here; everything else takes one on the way in.
       *
       * Taking it here in every case was wrong for exactly one caller. The
       * bootstrap's ticket was issued only once getSession had RESOLVED, so an
       * event arriving during that await retired a ticket that did not exist
       * yet, and the bootstrap then took a newer one and overwrote the newer
       * event with the older snapshot -- a cross-tab sign-out during startup
       * undone by the session that had already ended.
       */
      const isStillLatest = reservedTicket ?? syncGate.begin();

      /*
       * Superseded before this even began. Nothing here may write, including
       * the identity publication below, which would otherwise announce an
       * account that has already been replaced.
       */
      if (!isStillLatest()) {
        if (initialized) set({ initialized: true });
        return;
      }

      if (!session) {
        set({
          ...(initialized ? { initialized: true } : {}),
          status: 'signed-out',
          authReady: true,
          workspaceReady: true,
          session: null,
          workspaceId: '',
          workspaceRole: 'Owner',
        });
        return;
      }

      publishAuthIdentity(session);

      const accessProfile = await loadWorkspaceAccessProfile(session);
      if (!isStillLatest()) {
        /*
         * Overtaken while the profile was loading. The newer sync owns the
         * session state now -- but `initialized` is a one-time latch that
         * releases the app from its loading screen, so it is still set here or
         * a superseded first sync would leave the app waiting forever.
         */
        if (initialized) set({ initialized: true });
        return;
      }

      set({
        ...(initialized ? { initialized: true } : {}),
        status: 'signed-in',
        authReady: true,
        workspaceReady: true,
        session,
        workspaceId: accessProfile.workspaceId ?? '',
        workspaceRole: accessProfile.workspaceRole,
      });
    };

    /*
     * Subscribed BEFORE anything is awaited.
     *
     * PASSWORD_RECOVERY is a one-shot notification, scheduled by the URL
     * detection that getSession() waits on. Registering afterwards put it
     * behind getSession AND a workspace network round trip, so it could fire
     * with nobody listening -- and then a recovery arrival is indistinguishable
     * from an ordinary sign-in again, which is the whole thing this flag
     * exists to prevent.
     */
    /*
     * The receiving half of announceSpentRecovery: the durable record retires a
     * grant for a tab that was reloading, this retires it in tabs that are open.
     */
    let recoveryChannel: BroadcastChannel | null = null;
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        recoveryChannel = new BroadcastChannel(RECOVERY_CHANNEL);
        recoveryChannel.addEventListener('message', (event: MessageEvent) => {
          const message = event.data as { type?: string; userId?: string; grantToken?: string } | null;
          if (message?.type !== 'recovery-spent' || !message.userId) return;
          // Only the account whose grant was spent.
          if (get().passwordRecoveryFor !== message.userId) return;
          const heldGrant = readStoredRecoveryGrantToken();
          /*
           * A message naming the very grant this tab holds settles it by
           * itself, with no durable read.
           *
           * The write happens before the message is posted, but it is made in
           * another renderer and this one is not guaranteed to see it the
           * instant the message arrives -- so requiring the record to confirm
           * dropped the release outright, roughly one run in four, and the
           * other tab kept an enabled form on a spent link. A grant id cannot
           * be superseded the way an account can: a newly validated link has a
           * different one, which is the case the durable re-read was added for,
           * and it is still handled below.
           */
          if (heldGrant && message.grantToken === heldGrant) {
            set({ passwordRecoveryFor: '', passwordRecoveryGrant: '' });
            storeRecoveryUser('');
            return;
          }
          // Anything else -- no grant id, or one this tab is not holding -- is
          // only a prompt to consult the durable record.
          if (!isRecoveryGrantSpent(message.userId, heldGrant)) return;
          set({ passwordRecoveryFor: '', passwordRecoveryGrant: '' });
          storeRecoveryUser('');
        });
      }
    } catch {
      // Fall back to storage events if the channel cannot be opened.
    }
    const onRecoveryStorage = (event: StorageEvent) => {
      const recoveryFor = get().passwordRecoveryFor;
      if (!recoveryFor) return;
      const heldGrant = readStoredRecoveryGrantToken();
      /*
       * The PER-GRANT key belongs here too, and leaving it out stranded exactly
       * the case the per-grant keys were added for. When a reset finishes after
       * a newer link has become the account's active generation,
       * `completeRecoveryUpdateClaim` deliberately leaves the account marker
       * naming the newer grant and records the completion only under the spent
       * one's own key -- so a tab still holding that spent grant saw a write to
       * a key it was not listening for, and kept an enabled form on a link that
       * was already used until the customer submitted it or reloaded.
       *
       * Read from the same `heldGrant` the durable check below uses, so the
       * filter and the answer cannot end up describing different grants.
       */
      if (
        event.key !== RECOVERY_SPENT_KEY &&
        event.key !== `${RECOVERY_SPENT_USER_PREFIX}${recoveryFor}` &&
        !(heldGrant && event.key === recoverySpentGrantKey(recoveryFor, heldGrant))
      )
        return;
      // Read current durable state: a delayed event may predate a new link.
      if (!isRecoveryGrantSpent(recoveryFor, heldGrant)) return;
      set({ passwordRecoveryFor: '', passwordRecoveryGrant: '' });
      storeRecoveryUser('');
    };
    if (!recoveryChannel && typeof window !== 'undefined') window.addEventListener('storage', onRecoveryStorage);

    let bootstrapped = false;
    // Track auth events immediately, before asynchronous workspace hydration.
    // A tab opened after recovery still knows the account it later signs out.
    let lastAuthUserId = get().session?.user.id ?? '';
    /*
     * Every re-check still pending, so a teardown cannot apply an event to a
     * store the app has finished with.
     */
    const pendingCatchUps = new Set<StorageCatchUp>();
    const eventAgreesWithStorage = (session: Session | null) =>
      liveSessionAgrees(readAuthStorage(authStorageKey()), session, sessionGenerationOf);

    const applyAuthEvent = (event: AuthChangeEvent, rawSession: Session | null) => {
      /*
       * The event supplies the identity; STORAGE supplies the credential.
       *
       * Agreement is decided by session generation, which is right for identity
       * and silent about freshness: a broadcast delayed past another tab's
       * token refresh carries an older token of the same generation, agrees,
       * and used to be published verbatim -- leaving the store holding a
       * credential that expires while the session is still live, which every
       * caller reading the store's token rather than asking auth-js then sends.
       */
      const session = reconcilePublishedSession(readAuthStorage(authStorageKey()), rawSession, sessionGenerationOf);
      /*
       * One question, asked of every event: does the session auth-js has
       * actually STORED agree with what this event says?
       *
       * It replaces three separate guesses, and covers what each of them
       * missed. auth-js saves before it notifies, so the stored record is the
       * settled answer: a sign-out is this tab's only if nothing is stored, and
       * a session-bearing event is this tab's only if the stored session is the
       * same one. That holds in both storage modes, so there is no mode branch
       * here any more --
       *
       *   - with a per-tab store, a broadcast describes the tab that SENT it,
       *     and an event that disagrees is another tab's;
       *   - with a shared store, an event that disagrees is one a newer sign-in
       *     has already overtaken -- including a delayed SIGNED_IN, which used
       *     to be applied and left this store on account A while every request
       *     authenticated as account B.
       *
       * Read, never asked. `getSession()` from in here DEADLOCKS: auth-js
       * pushes the operation holding its lock into the same `pendingInLock`
       * queue that a nested `_acquireLock` awaits, so it waits on the operation
       * that is waiting for this callback to return. `lib/authStorage.ts` exists
       * so the record can be read synchronously instead, in either mode.
       */
      /*
       * A SIGNED_OUT that a newer sign-in has already overtaken.
       *
       * auth-js broadcasts SIGNED_OUT to every tab, and the receiving tab's
       * handler is `_notifyAllSubscribers(event, session, false)` -- it does
       * NOT remove that tab's session. So a sign-out in tab A, delivered after
       * tab B has validated a NEW recovery link for the same account, arrived
       * here describing a session B no longer has, and B revoked its own valid
       * grant permanently: a link that was never used, reported as already
       * used, with no way back except another email.
       *
       * The event carries no session -- that is why `lastAuthUserId` exists --
       * so the discriminator is what auth-js has PERSISTED. `signOut()` awaits
       * `_removeSession()` before it notifies, so in the tab that really signed
       * out, and in any tab whose session that sign-out actually ended, the
       * stored session is gone by the time this runs. A stored session still
       * matching the one this tab holds therefore means this event is about an
       * older one.
       *
       * An unreadable store reads as absent, which revokes: refusing a grant
       * that may still be good is the safe direction, and reviving one that is
       * spent is not.
       */
      const endedRecoveryGrant = event === 'SIGNED_OUT' ? recoveryGrantToken(get().session) : '';
      /*
       * SIGNED_OUT arrives with a null session, so the account whose session
       * ended has to have been remembered from the last one this tab saw. It
       * need not be a tab holding a grant: one opened after the recovery shares
       * the session and has no `passwordRecoveryFor` of its own, and revoking
       * only the local grant there recorded nothing at all -- so an ordinary
       * same-account sign-in afterwards left an unloaded recovery tab with a
       * live session matching its stale grant.
       */
      if (event === 'SIGNED_OUT') {
        if (lastAuthUserId) {
          /*
           * The PER-GRANT key first, and this is the security half.
           *
           * The account marker holds one generation. Written from a tab with no
           * recovery flag of its own it carries no grant id at all, so when a
           * later link B is validated `supersedeRecoveryGeneration` finds
           * nothing to displace and generation A is preserved NOWHERE. Spending
           * B then leaves `spent:B`, which says nothing about A -- and a tab
           * still holding A, reloaded against any ordinary session for the same
           * account, reads it as unspent and can change the password with no
           * current link.
           *
           * That is the same resurrection `supersedeRecoveryGeneration` exists
           * to prevent; it just could not see this one, because the marker that
           * displaced A never named A. So the ended generation is recorded
           * under its own permanent key here, BEFORE anything can forget it.
           * Accumulated keys can hold what the single marker cannot.
           */
          recordSpentRecoveryGrant(lastAuthUserId, endedRecoveryGrant);
          recordSpentRecoveryUser(lastAuthUserId);
        }
        lastAuthUserId = '';
      } else if (session) {
        lastAuthUserId = session.user.id;
      }
      // The event was previously discarded entirely, which is why a recovery
      // link used to look like a sign-in.
      if (event === 'PASSWORD_RECOVERY' && session) {
        const grantToken = recoveryGrantToken(session);
        // Supabase has validated the link; record WHO it was validated for.
        set({ passwordRecoveryFor: session.user.id, passwordRecoveryGrant: grantToken });
        storeRecoveryUser(session.user.id, grantToken);
        // Supabase has just validated a NEW link, so an earlier completion no
        // longer says anything about this account -- and the generation this
        // one replaces is over. Other account revocations must survive.
        supersedeRecoveryGeneration(session.user.id, grantToken);
      }
      if (event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        const recoveryFor = get().passwordRecoveryFor;
        /*
         * SIGNED_OUT: otherwise the authorization survives the session it
         * belonged to and is inherited by whoever signs in next in this tab.
         *
         * USER_UPDATED: a recovery ends when the password is actually set, and
         * that can happen in a DIFFERENT tab. auth-js broadcasts the recovery
         * to every open tab, but the store and sessionStorage that record it
         * are tab-local, so clearing only where updatePassword ran left the
         * other tabs holding a spent grant -- able to change the password again
         * with no new link. auth-js broadcasts this event after the update, so
         * every tab that took the grant hears that it is over.
         *
         * Clearing on any other user update is deliberate too: a grant should
         * not outlive a change to the account it was issued against.
         */
        set({ passwordRecoveryFor: '', passwordRecoveryGrant: '' });
        storeRecoveryUser('');
        if (event === 'SIGNED_OUT' && recoveryFor) {
          /*
           * Durably, so a tab that misses this transient sign-out cannot revive
           * its old grant after an ordinary same-account sign-in. A separate
           * fact from the signed-out account revoked above: a grant can outlive
           * the session it was issued for, so neither one covers the other.
           */
          recordSpentRecoveryUser(recoveryFor, endedRecoveryGrant);
        }
        if (event === 'USER_UPDATED' && session) {
          // Durably, so a tab that was reloading through this broadcast does
          // not come back holding the grant it just missed the end of.
          recordSpentRecoveryUser(session.user.id, recoveryFor === session.user.id ? recoveryGrantToken(session) : '');
        }
      }
      /*
       * The explicit getSession() below owns the first sync, so an event that
       * merely restates it is skipped -- but one that CONTRADICTS it takes
       * over, or the in-flight bootstrap silently overwrites it with a session
       * that has already ended. See lib/authBootstrap.ts.
       */
      const disposition = bootstrapEventDisposition({ bootstrapped, event });
      if (disposition === 'ignore') return;
      if (disposition === 'supersede') {
        /*
         * The bootstrap sync still in flight is writing about a session that
         * has been superseded, so it is retired before anything else: without
         * that it commits the obsolete session and workspace first, and
         * reconciliation can begin against the wrong account.
         */
        syncGate.retireInFlight();
        /*
         * Then this one is started NOW rather than held until the bootstrap
         * finishes. Holding it meant the new account's profile was not even
         * requested until the OLD account's request settled -- and if that
         * request hangs, it never does, so the app stayed gated on 'loading'
         * indefinitely for a session that would have resolved immediately.
         *
         * It also carries the `initialized` latch, because the bootstrap's own
         * sync may be the thing that is hanging: the app must be released by
         * whichever sync actually resolves, not only by the first one started.
         */
        void syncSessionState(session, true);
        return;
      }
      void syncSessionState(session);
    };

    const { data: subscription } = client.auth.onAuthStateChange((event, session) => {
      if (eventAgreesWithStorage(session)) {
        applyAuthEvent(event, session);
        return;
      }
      /*
       * Disagreement is not proof that the event is stale.
       *
       * localStorage is not synchronously coherent across renderer processes,
       * so another tab's SIGNED_IN can arrive here BEFORE the write it
       * describes is visible to this one. Reproduced 2 times in 120
       * instrumented runs: `BROADCAST event=SIGNED_IN eventSub=0002
       * storedSub=0001`, after the sending tab had already stored 0002. The
       * read said 0001, the good event was dropped, and this tab stayed on the
       * previous account until it was reloaded.
       *
       * A SIGNED_OUT is retried on the same terms, and the first version of
       * this fix wrongly excluded it. The reasoning given then -- that dropping
       * a sign-out which is not ours is the safe direction -- confused "safe"
       * with "correct". The asymmetry runs both ways: a REMOVAL is equally slow
       * to become visible, so a tab sharing the session that was just ended
       * reads it as still present, drops the sign-out for good, and goes on
       * showing an authenticated workspace for an account that has signed out.
       * Leaving a stale authenticated view is not the safe direction.
       *
       * Retrying cannot revoke a session this tab legitimately holds. Agreement
       * for a sign-out means storage is EMPTY: if this tab's session really is
       * still there, every attempt disagrees and the event is dropped exactly as
       * before, and if a newer sign-in has replaced it, storage is non-empty for
       * that reason and the sign-out is dropped too -- correctly, because the
       * event for that new session is the one this tab should act on.
       */
      const catchUp = waitForStorageCatchUp(
        () => eventAgreesWithStorage(session),
        () => {
          pendingCatchUps.delete(catchUp);
          applyAuthEvent(event, session);
        },
        (run, delayMs) => setTimeout(run, delayMs),
        (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      );
      pendingCatchUps.add(catchUp);
    });

    /*
     * There is deliberately NO fallback that reads `type=recovery` off the URL.
     *
     * A previous revision added one, meaning to be robust about the event's
     * timing. It was the opposite: the URL is supplied by whoever opened the
     * page, so any signed-in customer visiting /reset-password?type=recovery
     * would have marked their own live session recovery-authorized without
     * Supabase validating anything -- reopening, one commit later, exactly the
     * hole that gating on this flag was added to close. The same happens with
     * an EXPIRED fragment, where auth-js keeps the existing session after
     * validation fails.
     *
     * Only Supabase can attest that a recovery link was genuine, and it says
     * so by emitting PASSWORD_RECOVERY. That is why the subscriber above is
     * registered before anything is awaited: the answer to a missed
     * notification is to be listening earlier, not to believe the URL instead.
     */
    /*
     * Reserved before the await, so an event arriving DURING it can retire
     * this snapshot rather than being overwritten by it.
     *
     * DEFENCE IN DEPTH, not a fix for an observable defect. Two independent
     * investigations -- one here, one by the reviewer who raised the ordering
     * problem -- reached the same conclusion against @supabase/auth-js 2.100.1:
     *
     *   `getSession()` awaits initialization and then RE-READS storage
     *   (`_useSession` -> `__loadSession` -> `getItemAsync`). It holds no
     *   in-memory snapshot, so it cannot return a session another tab has
     *   already removed -- the value it returns has itself moved on, and
     *   agrees with the event rather than contradicting it.
     *
     *   The one exception looks like the race and is not: an EXPIRED stored
     *   session sends `__loadSession` into `_callRefreshToken`, which on
     *   success `_saveSession`s the refreshed session back to storage. Both
     *   the guarded and unguarded orderings then converge on that same
     *   refreshed state.
     *
     * Six rendered stagings were built against this and none discriminated;
     * that is recorded so the next person does not spend the same day on it.
     * The reservation stays because the ORDERING is wrong without it -- a
     * ticket that does not exist cannot be retired -- and because a future
     * auth-js release or a custom storage adapter need not keep the property
     * that currently makes it harmless.
     */
    const bootstrapIsLatest = syncGate.begin();
    const { data, error } = await client.auth.getSession();
    if (error) {
      // Even a failure must not speak for an account a newer event has
      // already replaced; the latch still releases the app either way.
      if (bootstrapIsLatest()) {
        set({
          initialized: true,
          status: 'signed-out',
          authReady: true,
          workspaceReady: true,
          session: null,
          workspaceId: '',
          workspaceRole: 'Owner',
        });
      } else {
        set({ initialized: true });
      }
    } else {
      await syncSessionState(data.session, true, bootstrapIsLatest);
    }
    bootstrapped = true;

    /*
     * Reconcile the grant once startup and queued events have settled. A tab
     * without a session must discard its stored grant even if it missed the
     * sign-out broadcast and no other tab recorded durable revocation.
     * Re-read the durable revocation too. A tab that was
     * reloading while another finished the reset can read its grant before the
     * other tab records the completion, and it is past the point where the
     * transient broadcast could have reached it.
     */
    const currentRecoveryFor = get().passwordRecoveryFor;
    if (
      currentRecoveryFor &&
      (!get().session || reconcileStoredRecoveryGrant(currentRecoveryFor, readStoredRecoveryGrantToken()) === '')
    ) {
      set({ passwordRecoveryFor: '', passwordRecoveryGrant: '' });
    }
    /*
     * And the tab-local marker is kept in step with the grant itself, including
     * where the store's own initializer already reconciled a spent grant away
     * before this ran. Otherwise a revoked id sits in sessionStorage and is
     * harmless only because every reader re-checks the durable revocation --
     * which is a fact about today's readers, not a property of the record.
     */
    if (!get().passwordRecoveryFor) storeRecoveryUser('');

    return () => {
      recoveryChannel?.close();
      if (typeof window !== 'undefined') window.removeEventListener('storage', onRecoveryStorage);
      subscription.subscription.unsubscribe();
      // A re-read still waiting on storage must not apply an event to a store
      // the app has finished with.
      for (const catchUp of pendingCatchUps) catchUp.cancel();
      pendingCatchUps.clear();
    };
  },
  setLastSyncAt: (value) => set({ lastSyncAt: value }),
  setSyncState: (state, message = '') => set({ syncState: state, syncMessage: message }),
  setWorkspaceAccessProfile: (workspaceId, workspaceRole = 'Admin') => set({ workspaceId, workspaceRole }),
  setAutosaveReady: (ready, unlocked) => set({ autosaveReady: ready, autosaveUnlocked: unlocked }),
  unlockAutosaveAfterManualSync: () => set((state) => (state.autosaveReady ? { autosaveUnlocked: true } : state)),
  sendMagicLink: async (email) => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return { ok: false, message: 'Enter an email address first.' };
    }

    const emailRedirectTo = currentAuthRedirectUrl();
    const { error } = await client.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        emailRedirectTo,
      },
    });

    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    return { ok: true, message: 'Magic link sent. Check your inbox to finish sign-in.' };
  },
  signInWithPassword: async (email, password) => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return { ok: false, message: 'Enter an email address first.' };
    }
    if (!password) {
      return { ok: false, message: 'Enter your password.' };
    }

    const { error } = await client.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    return { ok: true, message: 'Signed in. Opening your workspace.' };
  },
  /*
   * REQUIRES the Supabase Magic Link email template to contain {{ .Token }}.
   *
   * An earlier version of this comment claimed that omitting `emailRedirectTo`
   * is what makes Supabase send a code rather than a link. That is not true.
   * Supabase decides from the TEMPLATE: {{ .ConfirmationURL }} sends a magic
   * link, {{ .Token }} sends the six-digit code this screen asks for. The
   * default template is the link, so on an unconfigured project this flow emails
   * something the code input cannot accept — and the OAuth-only customer it
   * exists for stays locked out, now with a form that looks like it should work.
   *
   * The omission still matters, just not for that reason: a redirect would send
   * the customer to a browser, and the app needs the session itself.
   *
   * ios-submission/README.md carries this as a submission prerequisite, because
   * it cannot be configured from code and a build that ships without it has a
   * sign-in path that silently does not work.
   *
   * `shouldCreateUser: false` because this is a sign-IN. Left at its default it
   * silently creates an account for a typo'd address, and the customer waits
   * for a code on an inbox that was never theirs.
   */
  sendEmailCode: async (email) => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return { ok: false, message: 'Enter an email address first.' };
    }

    const { error } = await client.auth.signInWithOtp({
      email: trimmedEmail,
      options: { shouldCreateUser: false },
    });

    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    return { ok: true, message: 'Check your email for a sign-in code.' };
  },
  verifyEmailCode: async (email, code) => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const trimmedEmail = email.trim();
    const trimmedCode = code.trim();
    if (!trimmedEmail || !trimmedCode) {
      return { ok: false, message: 'Enter the email address and the code that was sent to it.' };
    }

    // 'email' covers both the sign-in code and the signup confirmation code.
    const { error } = await client.auth.verifyOtp({
      email: trimmedEmail,
      token: trimmedCode,
      type: 'email',
    });

    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    return { ok: true, message: 'Signed in.' };
  },
  signUpWithPassword: async (email, password) => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return { ok: false, message: 'Enter an email address first.' };
    }
    if (password.length < 8) {
      return { ok: false, message: 'Use at least 8 characters for the password.' };
    }

    const emailRedirectTo = currentAuthRedirectUrl();
    const { data, error } = await client.auth.signUp({
      email: trimmedEmail,
      password,
      options: {
        emailRedirectTo,
      },
    });

    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    if (data.session) {
      return { ok: true, outcome: 'signed-in', message: 'Account created. Opening your workspace.' };
    }

    /*
     * The obfuscated response for an address that is already registered: a user
     * object with no identities on it. Supabase documents the obfuscation but
     * not this shape, so treat a match as evidence and never as a guarantee --
     * the message below is worded to hold either way, which is what keeps this
     * honest if Supabase ever changes how it hides the fact.
     */
    const identities = data.user?.identities;
    const existing = Array.isArray(identities) && identities.length === 0;

    /*
     * Both cases get the same sentence, on purpose.
     *
     * Supabase hides the existing-account case to stop an attacker probing
     * addresses one at a time, and repeating the distinction here would hand
     * back exactly what it withholds. So the copy is written to be true under
     * either branch and to name the next step under both -- which is all the
     * customer needed. The outcome above stays machine-readable for callers
     * that must behave differently without saying anything different.
     */
    const message =
      `Check ${trimmedEmail}. If that address is new to XBAR, a confirmation link is on its way and you ` +
      `must open it before you can sign in. If it already has an account, nothing was sent -- sign in instead, ` +
      `or use "Forgot password?".`;

    return { ok: true, outcome: existing ? 'existing-account' : 'confirmation-required', message };
  },
  resendSignUpConfirmation: async (email) => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return { ok: false, message: 'Enter an email address first.' };
    }

    const { error } = await client.auth.resend({
      type: 'signup',
      email: trimmedEmail,
      options: { emailRedirectTo: currentAuthRedirectUrl() },
    });

    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    // Resend is subject to the same anti-enumeration silence as signup, so this
    // says what was asked for rather than what was delivered.
    return { ok: true, message: `Requested another confirmation email for ${trimmedEmail}.` };
  },
  /*
   * The half of "forgot password" that did not exist.
   *
   * `resetPasswordForEmail` sends the link, and because `detectSessionInUrl`
   * is on, opening it signs the customer in -- so it LOOKED like recovery
   * worked. Nothing anywhere in the app called `auth.updateUser`, so the
   * password itself was never changed: the customer got one session out of the
   * email and was locked out again as soon as it expired.
   */
  updatePassword: async (password) => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    if (password.length < 8) {
      return { ok: false, message: 'Use at least 8 characters for the password.' };
    }

    /*
     * Whose password is about to change, asked of the authority rather than of
     * a cached copy. The screen's gate compares the grant against the store's
     * `session`, which is written after a network round trip, while auth-js
     * persists a new session the instant one arrives.
     */
    let live: Awaited<ReturnType<typeof client.auth.getSession>>;
    try {
      live = await client.auth.getSession();
    } catch {
      /*
       * getSession takes auth-js's lock and can reject for the same reasons the
       * mutation can. Uncaught, that rejection leaves ResetPassword's busy flag
       * set and the screen disabled on "Saving..." for good.
       *
       * Definite wording: this failed BEFORE any password request was sent, so
       * nothing is uncertain and inventing a doubt would be its own dishonesty.
       */
      return { ok: false, message: 'We could not check who is signed in, so nothing was changed. Try again.' };
    }

    if (live.error || !live.data.session) {
      return { ok: false, message: 'Your session has ended. Request a new reset link from the sign-in screen.' };
    }

    const recoverySession = live.data.session;

    // A preceding tab can spend this grant before its announcement reaches us,
    // so the durable record is consulted rather than the tab's cached grant.
    const recoveryGrant = recoveryGrantToken(recoverySession);

    /*
     * Give up this tab's recovery marker -- but only while it still names the
     * grant being finished here.
     *
     * auth-js broadcasts PASSWORD_RECOVERY to every tab, and the subscriber
     * above ADOPTS it: a newer link validated anywhere in this browser rewrites
     * `passwordRecoveryFor` and the tab-local markers, including in a tab whose
     * own update is still in flight. Clearing unconditionally when that older
     * update finished therefore revoked a newer link that had never been used.
     * Both links are one-time, so if the tab that opened the newer one is then
     * closed, the browser holds its session with no authorization to use it and
     * no way back except another email.
     *
     * An unreadable store reads as absent and still clears. Refusing a grant
     * that may be good costs an email; reviving a spent one is the failure that
     * matters, and that is the same direction the auth listener takes.
     */
    const releaseRecoveryMarker = (finishedGrant: string) => {
      const heldGrant = readStoredRecoveryGrantToken();
      if (heldGrant && finishedGrant && heldGrant !== finishedGrant) return;
      set({ passwordRecoveryFor: '', passwordRecoveryGrant: '' });
      storeRecoveryUser('');
    };

    if (isRecoveryGrantSpent(recoverySession.user.id, recoveryGrant)) {
      releaseRecoveryMarker(recoveryGrant);
      return { ok: false, message: 'This reset link has already been used. Request a new reset link.' };
    }

    if (
      !hasValidatedPasswordRecovery({
        session: recoverySession,
        passwordRecoveryFor: get().passwordRecoveryFor,
        passwordRecoveryGrant: get().passwordRecoveryGrant,
      })
    ) {
      return {
        ok: false,
        message: 'This reset link was issued for a different account than the one signed in here. Request a new link.',
      };
    }

    /*
     * The change is CARRIED to the account it was validated for, rather than
     * aimed at whoever auth-js holds when it runs.
     *
     * Holding auth-js's session lock around the check and the mutation was the
     * previous answer, and it cannot hold this invariant. auth-js only uses a
     * real lock when `navigator.locks` exists; otherwise it selects `lockNoOp`,
     * which runs the callback immediately with no exclusion whatsoever. This
     * build targets safari13 (vite.config.ts), so that fallback is not
     * hypothetical -- on a browser we ship to, the lock protects nothing and
     * another tab can save a different session between the check and the
     * mutation's own reread.
     *
     * So the ambient read is removed rather than fenced. This request carries
     * the access token of the session the grant was validated against, and the
     * server applies the change to whoever that token belongs to. A switch
     * elsewhere can change what auth-js holds; it cannot change what was sent.
     * That holds with or without Web Locks, which is the point.
     */
    const request = buildPasswordUpdateRequest({
      supabaseUrl: supabaseConfig.url,
      anonKey: supabaseConfig.anonKey,
      accessToken: recoverySession.access_token,
      password,
    });

    const busy = (): CloudActionResult => ({
      ok: false,
      message:
        'This reset link is already being used in another tab. Wait for that attempt to finish, then request another link if it did not work.',
    });

    return withRecoveryUpdateExclusion(
      recoverySession.user.id,
      async () => {
        const claim = await claimRecoveryUpdate(recoverySession.user.id, recoveryGrant);
        if (!claim.ok) {
          if (claim.reason === 'spent') {
            releaseRecoveryMarker(recoveryGrant);
            return { ok: false, message: 'This reset link has already been used. Request a new reset link.' };
          }
          return {
            ok: false,
            message:
              claim.reason === 'busy'
                ? 'This reset link is already being used in another tab. Wait for that attempt to finish, then request another link if it did not work.'
                : 'We could not safely reserve this reset link, so nothing was changed. Try again.',
          };
        }

        let response: Response;
        const stopRenewingClaim = startRecoveryUpdateClaimRenewal(claim.claim);
        try {
          try {
            response = await fetch(request.url, {
              method: request.method,
              headers: request.headers,
              body: request.body,
            });
          } catch {
            /*
             * In flight when it failed, so whether the server applied it is genuinely
             * unknown -- claiming either outcome would be a guess. The grant is
             * spent conservatively: retrying this same link could race against a
             * request that actually reached GoTrue.
             */
            const spentFor = recoverySession.user.id;
            releaseRecoveryMarker(claim.claim.grantToken);
            completeRecoveryUpdateClaim(claim.claim);
            announceSpentRecovery(spentFor, claim.claim.grantToken);
            return {
              ok: false,
              uncertain: true,
              message:
                'We could not confirm that change. Try the new password; if it does not work, request another link.',
            };
          }

          if (!response.ok) {
            if (response.status >= 500) {
              // A gateway/server failure can follow an applied update. Do not allow
              // a retry to race a password change whose outcome is still unknown.
              const spentFor = recoverySession.user.id;
              releaseRecoveryMarker(claim.claim.grantToken);
              completeRecoveryUpdateClaim(claim.claim);
              announceSpentRecovery(spentFor, claim.claim.grantToken);
              return {
                ok: false,
                uncertain: true,
                message:
                  'We could not confirm that change. Try the new password; if it does not work, request another link.',
              };
            }
            const payload: unknown = await response.json().catch(() => null);
            const explained = readPasswordUpdateError(payload);
            clearRecoveryUpdateClaim(claim.claim);
            return {
              ok: false,
              // GoTrue's own words when it gave any: "New password should be
              // different from the old password" IS the answer the customer needs.
              message: explained
                ? describeAuthError(explained)
                : 'That change was refused and no reason was given. Try again, or request another link.',
            };
          }

          // Only now is the recovery finished; clearing it earlier would release the
          // screen while the password was still the old one.
          const spentFor = recoverySession.user.id;
          releaseRecoveryMarker(claim.claim.grantToken);
          completeRecoveryUpdateClaim(claim.claim);
          // auth-js is no longer in this path, so its USER_UPDATED broadcast will not
          // release the grant in other tabs. This module makes that announcement.
          announceSpentRecovery(spentFor, claim.claim.grantToken);
          return { ok: true, message: 'Password updated. You are signed in.' };
        } finally {
          stopRenewingClaim();
        }
      },
      busy,
      () => ({
        ok: false,
        message:
          'This browser cannot safely complete the reset. Use another up-to-date browser and request a new reset link. No password change was sent.',
      }),
    );
  },
  sendPasswordReset: async (email) => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return { ok: false, message: 'Enter the email address for this workspace.' };
    }

    /*
     * Deliberately NOT currentAuthRedirectUrl(): that returns the page the
     * request was made from, so the link dropped the customer back on the
     * login screen, already signed in, with no way to set a password. It has
     * to return them to the screen that can.
     */
    const nativePublicOrigin = authCallbackOrigin();
    const redirectTo = isNativeApp()
      ? // Undefined when VITE_PUBLIC_APP_URL is unset, which tells Supabase to
        // fall back to the project's own Site URL rather than to a dead scheme.
        nativePublicOrigin
        ? publicAppRouteUrl(passwordResetPath, nativePublicOrigin)
        : undefined
      : authRedirectUrl(passwordResetPath);
    const { error } = await client.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo,
    });

    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    // Supabase answers the same way for an address it has never seen, so the
    // only honest claim is about the request, not about a delivery.
    return {
      ok: true,
      message: `If ${trimmedEmail} has an XBAR account, a reset link is on its way. Check spam before asking again.`,
    };
  },
  signInWithFacebook: async () => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const redirectTo = currentAuthRedirectUrl();
    const { error } = await client.auth.signInWithOAuth({
      provider: 'facebook',
      options: {
        redirectTo,
      },
    });

    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    return { ok: true, message: 'Facebook sign-in started.' };
  },
  signInWithGoogle: async () => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const redirectTo = currentAuthRedirectUrl();
    const { error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo },
    });

    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    return { ok: true, message: 'Google sign-in started.' };
  },
  signInWithApple: async () => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const redirectTo = currentAuthRedirectUrl();
    const { error } = await client.auth.signInWithOAuth({
      provider: 'apple',
      options: { redirectTo },
    });

    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    return { ok: true, message: 'Apple sign-in started.' };
  },
  signOut: async () => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const recoveryFor = get().passwordRecoveryFor;
    const signingOutSession = get().session;
    const signedOutUserId = signingOutSession?.user.id;
    const recoveryGrant = recoveryFor && recoveryFor === signedOutUserId ? recoveryGrantToken(signingOutSession) : '';
    const { error } = await client.auth.signOut();
    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    if (recoveryFor) recordSpentRecoveryUser(recoveryFor, recoveryGrant);
    if (signedOutUserId) recordSpentRecoveryUser(signedOutUserId);
    set({
      session: null,
      status: 'signed-out',
      // Otherwise a later ordinary sign-in inherits a recovery that is over.
      passwordRecoveryFor: '',
      passwordRecoveryGrant: '',
      workspaceId: '',
      workspaceRole: 'Owner',
      syncState: 'idle',
      syncMessage: '',
      autosaveReady: false,
      autosaveUnlocked: false,
    });
    return { ok: true, message: 'Signed out of cloud sync.' };
  },
  deleteAccount: async (confirmation: string) => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }
    const token = get().session?.access_token;
    if (!token) {
      return { ok: false, message: 'You must be signed in to delete your account.' };
    }

    let response: Response;
    try {
      response = await fetch('/api/account/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ confirmation }),
      });
    } catch {
      return { ok: false, message: 'Could not reach the server. Check your connection and try again.' };
    }

    const payload = await response.json().catch(() => ({}) as { ok?: boolean; message?: string });
    if (!response.ok || !payload.ok) {
      return { ok: false, message: payload.message || 'Account deletion failed. Please try again.' };
    }

    // The server has already deleted the auth user; clear the local session so
    // the app returns to the signed-out state. Caller purges the local workspace.
    const recoveryFor = get().passwordRecoveryFor;
    const deletingSession = get().session;
    const recoveryGrant =
      recoveryFor && recoveryFor === deletingSession?.user.id ? recoveryGrantToken(deletingSession) : '';
    await client.auth.signOut().catch(() => {});
    if (recoveryFor) recordSpentRecoveryUser(recoveryFor, recoveryGrant);
    set({
      session: null,
      status: 'signed-out',
      // Otherwise a later ordinary sign-in inherits a recovery that is over.
      passwordRecoveryFor: '',
      passwordRecoveryGrant: '',
      workspaceId: '',
      workspaceRole: 'Owner',
      syncState: 'idle',
      syncMessage: '',
      autosaveReady: false,
      autosaveUnlocked: false,
    });
    return { ok: true, message: 'Your account and data have been deleted.' };
  },
}));
