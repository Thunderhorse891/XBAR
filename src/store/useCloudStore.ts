import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { authCallbackOrigin } from '@/lib/nativePlatform';
import { loadWorkspaceAccessProfile } from '@/lib/cloudWorkspace';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import type { UserRole } from '@/types/xbar';

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
  initialize: () => Promise<(() => void) | void>;
  setLastSyncAt: (value: string) => void;
  setSyncState: (state: CloudSyncState, message?: string) => void;
  setAutosaveReady: (ready: boolean) => void;
  signInWithPassword: (email: string, password: string) => Promise<CloudActionResult>;
  sendMagicLink: (email: string) => Promise<CloudActionResult>;
  signUpWithPassword: (email: string, password: string) => Promise<CloudActionResult>;
  sendPasswordReset: (email: string) => Promise<CloudActionResult>;
  /**
   * Passwordless sign-in that works without a redirect.
   *
   * Every other recovery path builds a callback from window.location.origin,
   * which is capacitor://localhost inside the app — an origin no email client
   * can open and Supabase will not allow-list. A one-time code is verified
   * in-app instead, so it is the only credential-free way into a store build,
   * and the only route for an account that was created through Google, Apple
   * or Facebook and therefore has no password at all.
   */
  sendEmailCode: (email: string) => Promise<CloudActionResult>;
  verifyEmailCode: (email: string, code: string) => Promise<CloudActionResult>;
  signInWithFacebook: () => Promise<CloudActionResult>;
  signInWithGoogle: () => Promise<CloudActionResult>;
  signInWithApple: () => Promise<CloudActionResult>;
  signOut: () => Promise<CloudActionResult>;
  deleteAccount: (confirmation: string) => Promise<CloudActionResult>;
};

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
  setAutosaveReady: (ready) => set({ autosaveReady: ready }),
  sendMagicLink: async (email) => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return { ok: false, message: 'Enter an email address first.' };
    }

    // authCallbackOrigin, not window.location.origin: inside the app that is
    // capacitor://localhost, which no email client can open.
    const emailRedirectTo = authCallbackOrigin();
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

    const emailRedirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined;
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

    // See authCallbackOrigin: a reset link pointing at capacitor://localhost is
    // unopenable, so a store build sends the customer to the public site.
    const redirectTo = authCallbackOrigin();
    const { error } = await client.auth.resetPasswordForEmail(trimmedEmail, {
      redirectTo,
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: 'Password reset email sent.' };
  },
  sendEmailCode: async (email) => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return { ok: false, message: 'Enter the email address for this workspace.' };
    }

    // No emailRedirectTo on purpose: omitting it keeps this flow independent of
    // the page origin, which is what makes it work inside the app's WebView.
    // shouldCreateUser is false because this is a sign-in path — without it a
    // typo would silently create a new account instead of failing.
    const { error } = await client.auth.signInWithOtp({
      email: trimmedEmail,
      options: { shouldCreateUser: false },
    });

    if (error) {
      return { ok: false, message: error.message };
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
      return { ok: false, message: 'Enter your email and the code from your inbox.' };
    }

    const { error } = await client.auth.verifyOtp({
      email: trimmedEmail,
      token: trimmedCode,
      type: 'email',
    });

    if (error) {
      return { ok: false, message: error.message };
    }

    return { ok: true, message: 'Signed in.' };
  },
  signInWithFacebook: async () => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const redirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined;
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

    const redirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined;
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

    const redirectTo =
      typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined;
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
    });
    return { ok: true, message: 'Your account and data have been deleted.' };
  },
}));
