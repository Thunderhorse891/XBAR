import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { loadWorkspaceAccessProfile } from '@/lib/cloudWorkspace';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import type { UserRole } from '@/types/xbar';
import { authCallbackOrigin, isNativeApp } from '../lib/nativePlatform.js';

type CloudActionResult = {
  ok: boolean;
  message: string;
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
  signUpWithPassword: (email: string, password: string) => Promise<CloudActionResult>;
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

    const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
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
      return { ok: false, message: error.message };
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
      return { ok: false, message: error.message };
    }

    return { ok: true, message: 'Signed in. Opening your workspace.' };
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
    const { error } = await client.auth.signUp({
      email: trimmedEmail,
      password,
      options: {
        emailRedirectTo,
      },
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: 'Account created. Check your inbox if email confirmation is required.' };
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

    const redirectTo = currentAuthRedirectUrl();
    const { error } = await client.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo,
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: 'Password reset email sent.' };
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
      return { ok: false, message: error.message };
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
      return { ok: false, message: error.message };
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
      return { ok: false, message: error.message };
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
      return { ok: false, message: error.message };
    }

    set({
      session: null,
      status: 'signed-out',
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
