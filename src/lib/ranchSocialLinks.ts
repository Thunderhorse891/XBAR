/** Public profile addresses only. Saving a link never signs in or grants posting access. */
export const RANCH_SOCIAL_PLATFORMS = [
  { key: 'instagram', label: 'Instagram', example: 'https://www.instagram.com/yourranch' },
  { key: 'facebook', label: 'Facebook', example: 'https://www.facebook.com/yourranch' },
  { key: 'x', label: 'X', example: 'https://x.com/yourranch' },
  { key: 'youtube', label: 'YouTube', example: 'https://www.youtube.com/@yourranch' },
  { key: 'tiktok', label: 'TikTok', example: 'https://www.tiktok.com/@yourranch' },
] as const;
export type RanchSocialPlatform = (typeof RANCH_SOCIAL_PLATFORMS)[number]['key'];
export type RanchSocialLinks = Partial<Record<RanchSocialPlatform, string>>;
const hosts: Record<RanchSocialPlatform, readonly string[]> = {
  instagram: ['instagram.com', 'www.instagram.com'],
  facebook: ['facebook.com', 'www.facebook.com', 'm.facebook.com'],
  x: ['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com'],
  youtube: ['youtube.com', 'www.youtube.com'],
  tiktok: ['tiktok.com', 'www.tiktok.com'],
};
export function normalizeRanchSocialLink(platform: RanchSocialPlatform, input: unknown): string {
  if (input === undefined || input === '') return '';
  if (typeof input !== 'string' || input.length > 2048) throw new Error('Enter a valid public profile URL.');
  const value = input.trim();
  if (!value) return '';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Use the full https:// address of your public profile.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    !hosts[platform].includes(url.hostname)
  ) {
    throw new Error('Use a secure public profile URL on the selected platform.');
  }
  const path = url.pathname.replace(/\/$/, '');
  const reserved =
    /^(?:accounts|explore|direct|p|reel|reels|stories|login|logout|intent|i|home|search|share|sharer|sharer.php|dialog|marketplace|groups|watch|feed|settings)$/i;
  const parts = path.slice(1).split('/');
  const simple = parts.length === 1 && /^[a-zA-Z0-9_.-]+$/.test(parts[0]) && !reserved.test(parts[0]);
  const valid =
    platform === 'facebook'
      ? (simple && path !== '/profile.php') ||
        (path === '/profile.php' && /^\d+$/.test(url.searchParams.get('id') || '')) ||
        /^\/people\/[^/]+\/\d+$/.test(path) ||
        /^\/pages\/[^/]+\/\d+$/.test(path)
      : platform === 'youtube'
        ? /^\/@[a-zA-Z0-9_.-]+$/.test(path) || /^\/(?:channel|c|user)\/[a-zA-Z0-9_-]+$/.test(path)
        : platform === 'tiktok'
          ? /^\/@[a-zA-Z0-9_.]+$/.test(path)
          : simple;
  if (!valid) throw new Error('Link to a public profile or page, rather than a post, feed, or marketplace.');
  const id = platform === 'facebook' && path === '/profile.php' ? url.searchParams.get('id') : null;
  url.search = '';
  url.hash = '';
  if (id) url.searchParams.set('id', id);
  return url.toString();
}

export function normalizeRanchSocialLinks(raw: unknown, strict = false): RanchSocialLinks {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    if (strict) throw new Error('Ranch social links must be profile addresses.');
    return {};
  }
  const result: RanchSocialLinks = {};
  for (const { key, label } of RANCH_SOCIAL_PLATFORMS) {
    try {
      const value = normalizeRanchSocialLink(key, (raw as Record<string, unknown>)[key]);
      if (value) result[key] = value;
    } catch (error) {
      if (strict)
        throw Object.assign(new Error(`${label}: ${error instanceof Error ? error.message : 'Invalid profile URL.'}`), {
          cause: error,
        });
    }
  }
  return result;
}
