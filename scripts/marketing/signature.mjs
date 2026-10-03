import { readFileSync } from 'node:fs';

const geometry = JSON.parse(
  readFileSync(new URL('../../public/brand/xbar-signature-paths.json', import.meta.url), 'utf8'),
);
export function signatureSvg({ hero = false, className = '', label = '' } = {}) {
  const paths = hero ? geometry.paths : geometry.compactPaths;
  const base = paths
    .map((path) => `<path d="${path.d}"${path.fillRule ? ` fill-rule="${path.fillRule}"` : ''} />`)
    .join('');
  const trace = paths.map((path) => `<path class="xbar-signature__trace" d="${path.d}" pathLength="1" />`).join('');
  return `<svg class="xbar-signature${hero ? ' xbar-signature--hero' : ''}${className ? ` ${className}` : ''}" data-xbar-signature viewBox="${hero ? geometry.viewBox : geometry.compactViewBox}"${label ? ` role="img" aria-label="${label}"` : ' aria-hidden="true"'}><g class="xbar-signature__base">${base}</g><g>${trace}</g></svg>`;
}
