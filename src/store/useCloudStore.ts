import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import { getSupabaseClient } from '@/lib/supabaseClient';
import { isSupabaseConfigured } from '@/lib/platformConfig';

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
  lastSyncAt: string;
  syncState: CloudSyncState;
  syncMessage: string;
  initialize: () => Promise<(() => void) | void>;
  setLastSyncAt: (value: string) => void;
  setSyncState: (state: CloudSyncState, message?: string) => void;
  sendMagicLink: (email: string) => Promise<CloudActionResult>;
  signInWithFacebook: () => Promise<CloudActionResult>;
  signOut: () => Promise<CloudActionResult>;
};

export const useCloudStore = create<CloudStore>((set, get) => ({
  initialized: false,
  status: isSupabaseConfigured() ? 'loading' : 'unavailable',
  session: null,
  lastSyncAt: '',
  syncState: 'idle',
  syncMessage: '',
  initialize: async () => {
    if (get().initialized) {
      return;
    }

    const client = getSupabaseClient();
    if (!client) {
      set({ initialized: true, status: 'unavailable', session: null });
      return;
    }

    const { data, error } = await client.auth.getSession();
    if (error) {
      set({ initialized: true, status: 'signed-out', session: null });
    } else {
      set({
        initialized: true,
        status: data.session ? 'signed-in' : 'signed-out',
        session: data.session,
      });
    }

    const { data: subscription } = client.auth.onAuthStateChange((_event, session) => {
      set({
        status: session ? 'signed-in' : 'signed-out',
        session,
      });
    });

    return () => subscription.subscription.unsubscribe();
  },
  setLastSyncAt: (value) => set({ lastSyncAt: value }),
  setSyncState: (state, message = '') => set({ syncState: state, syncMessage: message }),
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
  signOut: async () => {
    const client = getSupabaseClient();
    if (!client) {
      return { ok: false, message: 'Supabase is not configured for this build.' };
    }

    const { error } = await client.auth.signOut();
    if (error) {
      return { ok: false, message: error.message };
    }

    set({ session: null, status: 'signed-out' });
    set({ syncState: 'idle', syncMessage: '' });
    return { ok: true, message: 'Signed out of cloud sync.' };
  },
}));
