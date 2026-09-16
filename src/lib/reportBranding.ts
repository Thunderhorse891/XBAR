export type ReportBranding = { logo: Uint8Array; mark: Uint8Array; watermark: Uint8Array };

export function reportBrandAssetPaths(base = '/') {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return ['xbar-report-horse.png', 'xbar-report-mark.png', 'xbar-report-watermark.png'].map(
    (name) => `${prefix}brand/${name}`,
  );
}

async function availableCache() {
  try {
    return typeof caches === 'undefined' ? undefined : await caches.open('xbar-report-brand-v1');
  } catch {
    return undefined;
  }
}

function isPng(bytes: Uint8Array) {
  return [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value);
}

/** Keep the originals usable after a successful export, even without a service worker. */
export async function loadReportBranding(
  base = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL || '/',
  fetchAsset: typeof fetch = fetch,
  cache?: Pick<Cache, 'match' | 'put'>,
): Promise<ReportBranding> {
  const storage = cache ?? (await availableCache());
  const load = async (path: string) => {
    try {
      const response = await fetchAsset(path);
      if (!response.ok) throw new Error('Brand image unavailable');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!isPng(bytes)) throw new Error('Invalid brand image');
      // Storage denial must not prevent an otherwise successful export.
      try {
        await storage?.put(path, new Response(bytes, { headers: { 'Content-Type': 'image/png' } }));
      } catch {
        /* optional cache */
      }
      return bytes;
    } catch {
      try {
        const saved = await storage?.match(path);
        if (saved?.ok) {
          const bytes = new Uint8Array(await saved.arrayBuffer());
          if (isPng(bytes)) return bytes;
        }
      } catch {
        /* optional cache */
      }
      throw new Error('Report artwork is unavailable. Reconnect and try again; your records are unchanged.');
    }
  };
  const [logo, mark, watermark] = await Promise.all(reportBrandAssetPaths(base).map(load));
  return { logo, mark, watermark };
}
