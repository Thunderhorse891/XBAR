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

  const popup = window.open(dialogUrl, 'xbar-facebook-share', 'popup=yes,width=720,height=760,noopener,noreferrer');

  if (!popup) {
    return {
      ok: false,
      message: 'Allow pop-ups to open the Facebook share window.',
    };
  }

  popup.focus();
  return {
    ok: true,
    message: 'Facebook share window opened.',
    url: dialogUrl,
  };
}
