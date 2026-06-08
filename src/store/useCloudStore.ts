import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
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
  signInWithFacebook: () => Promise<CloudActionResult>;
  signInWithGoogle: () => Promise<CloudActionResult>;
  signInWithApple: () => Promise<CloudActionResult>;
  signOut: () => Promise<CloudActionResult>;
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
    set({ initialized: true });

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

    const emailRedirectTo = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined;
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

    const emailRedirectTo = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined;
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

    const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined;
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

    const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined;
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

    const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined;
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

    const redirectTo = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : undefined;
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

    set({ session: null, status: 'signed-out', workspaceId: '', workspaceRole: 'Owner', syncState: 'idle', syncMessage: '', autosaveReady: false });
    return { ok: true, message: 'Signed out of cloud sync.' };
  },
}));
