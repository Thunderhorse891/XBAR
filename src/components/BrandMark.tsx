import type { SVGProps } from 'react';

type BrandMarkProps = SVGProps<SVGSVGElement> & {
  title?: string;
  tone?: 'color' | 'mono';
};

// 40KB apple-touch-icon — identical squircle-X artwork as the 1.53MB
// xbar-app-icon, but every in-app render is small (≤64px), so the large
// source is pure download weight.
export const XBAR_MAIN_LOGO_SRC = '/brand/apple-touch-icon.png';

export function XbarMark({ title, tone: _tone = 'color', ...props }: BrandMarkProps) {
  return (
    <svg viewBox="0 0 64 64" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} {...props}>
      {title ? <title>{title}</title> : null}
      <image
        href={XBAR_MAIN_LOGO_SRC}
        xlinkHref={XBAR_MAIN_LOGO_SRC}
        x="0"
        y="0"
        width="64"
        height="64"
        preserveAspectRatio="xMidYMid meet"
      />
    </svg>
  );
}

export function XbarWordmark({ title = 'XBAR', tone = 'color', ...props }: BrandMarkProps) {
  const mono = tone === 'mono';

  return (
    <svg viewBox="0 0 236 64" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} {...props}>
      {title ? <title>{title}</title> : null}
      <XbarMark x="0" y="0" width="64" height="64" tone={tone} />
      <text
        x="82"
        y="39"
        /* --xbar-warm-white: the token warm white, not the stale spec's #f8fbff. */
        fill={mono ? 'currentColor' : '#f5f2ec'}
        fontFamily="'Outfit', 'Avenir Next', sans-serif"
        fontSize="28"
        fontWeight="800"
        letterSpacing="5.8"
      >
        XBAR
      </text>
      <path
        d="M84 49.5h126"
        /* --accent-edge: the token edge blue, not the stale spec's #3D8EFF. */
        stroke={mono ? 'currentColor' : '#0078d7'}
        strokeLinecap="round"
        strokeWidth="1.5"
        opacity="0.58"
      />
    </svg>
  );
}
