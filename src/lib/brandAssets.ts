export const brandAssetBase = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL || '/';

/** Resolve supplied public/brand artwork against Vite's deployment base. */
export function brandAssetPath(name: string, base = brandAssetBase) {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${prefix}brand/${name}`;
}
