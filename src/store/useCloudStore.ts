import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { loadWorkspaceAccessProfile } from '@/lib/cloudWorkspace';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import type { UserRole } from '@/types/xbar';
import { authCallbackOrigin, isNativeApp } from '../lib/nativePlatform.js';
import { describeAuthError } from '@/lib/authErrors';
import { appRouteUrl, passwordResetPath, publicAppRouteUrl } from '@/lib/routeCanon';

type CloudActionResult = {
  ok: boolean;
  message: string;
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
   * True from the moment a recovery link establishes a session until a new
   * password is actually set. `detectSessionInUrl` signs the customer in the
   * instant they open that link, so without this the app cannot tell them
   * apart from an ordinary sign-in -- and it used to route them straight into
   * the workspace, password unchanged, with nothing left to click.
   */
  passwordRecoveryPending: boolean;
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

export const useCloudStore = create<CloudStore>((set, get) => ({
  initialized: false,
  passwordRecoveryPending: false,
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

    const syncSessionState = async (session: Session | null, initialized = false) => {
      if (!session) {
        set({
          ...(initialized ? { initialized: true } : {}),
          status: 'signed-out',
          session: null,
          workspaceId: '',
          workspaceRole: 'Owner',
        });
        return;
      }

      const accessProfile = await loadWorkspaceAccessProfile(session);
      set({
        ...(initialized ? { initialized: true } : {}),
        status: 'signed-in',
        session,
        workspaceId: accessProfile.workspaceId ?? '',
        workspaceRole: accessProfile.workspaceRole,
      });
    };

    const { data, error } = await client.auth.getSession();
    if (error) {
      set({ initialized: true, status: 'signed-out', session: null, workspaceId: '', workspaceRole: 'Owner' });
    } else {
      await syncSessionState(data.session, true);
    }

    const { data: subscription } = client.auth.onAuthStateChange((event, session) => {
      // The event was previously discarded, which is why a recovery link was
      // indistinguishable from a sign-in.
      if (event === 'PASSWORD_RECOVERY') set({ passwordRecoveryPending: true });
      void syncSessionState(session);
    });

    return () => subscription.subscription.unsubscribe();
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

    const { error } = await client.auth.updateUser({ password });

    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    // Only now is the recovery finished; clearing it earlier would release the
    // screen while the password was still the old one.
    set({ passwordRecoveryPending: false });
    return { ok: true, message: 'Password updated. You are signed in.' };
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
      : appRouteUrl(passwordResetPath);
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

    const { error } = await client.auth.signOut();
    if (error) {
      return { ok: false, message: describeAuthError(error.message) };
    }

    set({
      session: null,
      status: 'signed-out',
      // Otherwise a later ordinary sign-in inherits a recovery that is over.
      passwordRecoveryPending: false,
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
    await client.auth.signOut().catch(() => {});
    set({
      session: null,
      status: 'signed-out',
      // Otherwise a later ordinary sign-in inherits a recovery that is over.
      passwordRecoveryPending: false,
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
