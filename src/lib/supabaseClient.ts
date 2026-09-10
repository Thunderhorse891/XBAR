import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabaseConfig } from '@/lib/platformConfig';
import { authStorageAdapter } from '@/lib/authStorage';

let supabaseClient: SupabaseClient | null = null;

/*
 * The key auth-js persists the session under, stated rather than inferred.
 *
 * supabase-js derives exactly this (`sb-<first hostname label>-auth-token`) when
 * no key is given, so passing it changes nothing for anyone already signed in --
 * it is the same string, and no session moves. What it buys is a value this
 * codebase can READ. A `SIGNED_OUT` broadcast from another tab carries no
 * session, so the only way to tell one that ends the session this tab holds
 * from one that a newer sign-in has already replaced is to look at what auth-js
 * has actually persisted. See the stale-sign-out fence in `useCloudStore`.
 *
 * Deriving it in two places is what would make this fragile, which is why it is
 * derived here once and exported.
 */
export function authStorageKey(): string {
  try {
    return `sb-${new URL(supabaseConfig.url).hostname.split('.')[0]}-auth-token`;
  } catch {
    return '';
  }
}

export function getSupabaseClient() {
  if (!isSupabaseConfigured()) {
    return null;
  }

  if (!supabaseClient) {
    supabaseClient = createClient(supabaseConfig.url, supabaseConfig.anonKey, {
      auth: {
        // Identical to the value auth-js would derive on its own; see above.
        storageKey: authStorageKey(),
        // Supplied rather than chosen, so this app can read what auth-js keeps
        // in EITHER mode. See `lib/authStorage.ts`.
        storage: authStorageAdapter,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return supabaseClient;
}
