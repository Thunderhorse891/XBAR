import { isNativeApp } from './nativePlatform.js';
import { facebookConfig, isFacebookSharingConfigured } from './platformConfig.js';

type FacebookShareResult = {
  ok: boolean;
  message: string;
  url?: string;
};

function normalizeAppPath(path: string) {
  return path.startsWith('/') ? path : `/${path}`;
}

function ensureTrailingSlash(value: string) {
  return value.endsWith('/') ? value : `${value}/`;
}

function readBaseUrl() {
  return (
    (typeof import.meta !== 'undefined' &&
      (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.BASE_URL) ||
    '/'
  );
}

export function buildPublicShareUrl(path: string, shareToken?: string) {
  const normalizedPath = normalizeAppPath(path);
  const tokenSuffix = shareToken
    ? `${normalizedPath.includes('?') ? '&' : '?'}t=${encodeURIComponent(shareToken)}`
    : '';
  const configuredBase = facebookConfig.publicAppUrl;

  if (configuredBase) {
    return `${ensureTrailingSlash(configuredBase.replace(/#.*$/, ''))}#${normalizedPath}${tokenSuffix}`;
  }

  if (typeof window !== 'undefined') {
    const base = new URL(readBaseUrl(), window.location.origin);
    return `${base.toString()}#${normalizedPath}${tokenSuffix}`;
  }

  return `#${normalizedPath}${tokenSuffix}`;
}

export function buildFacebookShareDialogUrl(path: string, shareToken?: string) {
  if (!isFacebookSharingConfigured()) {
    return null;
  }

  const shareUrl = buildPublicShareUrl(path, shareToken);
  const redirectUrl = typeof window !== 'undefined' ? `${window.location.origin}${window.location.pathname}` : shareUrl;
  const dialogUrl = new URL('https://www.facebook.com/dialog/share');
  dialogUrl.searchParams.set('app_id', facebookConfig.appId);
  dialogUrl.searchParams.set('display', 'popup');
  dialogUrl.searchParams.set('href', shareUrl);
  dialogUrl.searchParams.set('redirect_uri', redirectUrl);
  return dialogUrl.toString();
}

export function openFacebookShareDialog(path: string, shareToken?: string): FacebookShareResult {
  const dialogUrl = buildFacebookShareDialogUrl(path, shareToken);
  if (!dialogUrl) {
    return {
      ok: false,
      message: 'Facebook sharing is not configured for this build yet.',
    };
  }

  if (typeof window === 'undefined') {
    return {
      ok: false,
      message: 'Facebook sharing only works in the browser.',
    };
  }

  // No `noopener` / `noreferrer` in the feature string, deliberately. Either one
  // makes window.open return null by spec even when the window opens — verified
  // directly in Chromium — so with them present the check below could never
  // pass. This function reported "allow pop-ups" on every single call, including
  // the ones where the dialog was already on screen, and popup.focus() was
  // unreachable code. Severing `opener` by hand gives the same protection
  // against reverse-tabnabbing while leaving the return value meaningful, which
  // is what lets callers fall back to copying the link when a pop-up really was
  // blocked.
  const popup = window.open(dialogUrl, 'xbar-facebook-share', 'popup=yes,width=720,height=760');

  if (popup) {
    // Both of these are safe on a cross-origin window (checked in Chromium);
    // guarded anyway, because failing to focus is not a reason to report that
    // the share window never opened.
    try {
      popup.opener = null;
      popup.focus();
    } catch {
      /* the window is open either way, which is what the result reports */
    }
    return {
      ok: true,
      message: 'Facebook share window opened.',
      url: dialogUrl,
    };
  }

  // A store build reaches here on success, not failure: Capacitor's WebView
  // hands the URL to the system browser and returns nil regardless, so a null
  // popup says nothing about whether the dialog opened. Reporting a blocked
  // pop-up would send the caller down a fallback it does not need.
  if (isNativeApp()) {
    return {
      ok: true,
      message: 'Opening the Facebook share window.',
      url: dialogUrl,
    };
  }

  return {
    ok: false,
    message: 'Allow pop-ups to open the Facebook share window.',
  };
}
