/*
 * localStorage that reports rather than throws.
 *
 * Reaching for `window.localStorage` is itself a throwing operation: a browser
 * configured to block site data raises SecurityError from the GETTER, so even
 * `typeof` on it throws before any method is named. A quota that is full
 * throws from `setItem` instead.
 *
 * Every unguarded call site is therefore a crash waiting for one customer's
 * browser settings, and four of them were: two copies of the command-centre
 * check, the surface-mode write, and the sale-packet log. The check runs
 * during render, so with site data blocked the error boundary replaced the
 * WHOLE APP with "This screen hit a runtime problem" -- including the
 * password-reset screen, which auth-js was otherwise perfectly able to serve
 * from its in-memory adapter.
 *
 * None of these values is worth an outage. They are conveniences: a remembered
 * surface mode, an entry marker, a local log. Absent is a fine answer for all
 * of them, and it is the answer a blocked browser gets.
 *
 * This is deliberately NOT a fallback store. Anything that must survive
 * blocked storage has to say so explicitly, rather than silently getting
 * memory and behaving as though it were durable.
 */

export function readBrowserStorage(key: string): string | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Returns whether the value was actually stored, so a caller can care if it needs to. */
export function writeBrowserStorage(key: string, value: string): boolean {
  try {
    if (typeof window === 'undefined') return false;
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeBrowserStorage(key: string): boolean {
  try {
    if (typeof window === 'undefined') return false;
    window.localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
