import { apiConfig } from './platformConfig.js';

/** Web uses same-origin routes; the bundled native build supplies its HTTPS backend. */
export function apiUrl(path: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${apiConfig.baseUrl.replace(/\/+$/, '')}${normalizedPath}`;
}
