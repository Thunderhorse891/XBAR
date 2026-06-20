import type { SVGProps } from 'react';

type BrandMarkProps = SVGProps<SVGSVGElement> & {
  title?: string;
  tone?: 'color' | 'mono';
};

export const XBAR_MAIN_LOGO_SRC = '/brand/xbar_public_assets/public/main%20logo.png';

export function XbarMark({ title, tone = 'color', ...props }: BrandMarkProps) {
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
        fill={mono ? 'currentColor' : '#f8fbff'}
        fontFamily="'Outfit', 'Avenir Next', sans-serif"
        fontSize="28"
        fontWeight="800"
        letterSpacing="5.8"
      >
        XBAR
      </text>
      <path d="M84 49.5h126" stroke={mono ? 'currentColor' : '#3D8EFF'} strokeLinecap="round" strokeWidth="1.5" opacity="0.58" />
    </svg>
  );
}
