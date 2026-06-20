import type { SVGProps } from 'react';

type BrandMarkProps = SVGProps<SVGSVGElement> & {
  title?: string;
  tone?: 'color' | 'mono' | 'light';
};

export function XbarMark({ title, tone = 'color', ...props }: BrandMarkProps) {
  const mono = tone === 'mono';
  const light = tone === 'light';

  return (
    <svg
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      className={!mono && !light ? 'xbar-mark--glow' : undefined}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient id="xbar-mark-steel" x1="9" x2="55" y1="7" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#C8D0DA" />
          <stop offset="0.42" stopColor="#8fa5b8" />
          <stop offset="1" stopColor="#2C3038" />
        </linearGradient>
        <linearGradient id="xbar-mark-blue" x1="19" x2="49" y1="13" y2="53" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8edcff" />
          <stop offset="0.5" stopColor="#3D8EFF" />
          <stop offset="1" stopColor="#2D6FFF" />
        </linearGradient>
        <filter id="xbar-mark-glow" x="-40%" y="-40%" width="180%" height="180%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feColorMatrix in="blur" type="matrix" values="0 0 0 0 0.176  0 0 0 0 0.435  0 0 0 0 1  0 0 0 0.5 0" result="coloredBlur" />
          <feMerge>
            <feMergeNode in="coloredBlur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      {/* Decorative chevron strokes — near-white on dark, dark on light */}
      <g
        fill="none"
        stroke={mono ? 'currentColor' : light ? 'rgba(0,0,0,0.15)' : 'rgba(248,251,255,0.62)'}
        strokeWidth="1.15"
        vectorEffect="non-scaling-stroke"
      >
        <path d="M11 16.5 25.8 32 11 47.5" opacity="0.45" />
        <path d="M53 16.5 38.2 32 53 47.5" opacity="0.45" />
      </g>
      <g filter={!mono && !light ? 'url(#xbar-mark-glow)' : undefined}>
        <path
          d="M9.5 10.5h11.8l10.9 13.9 11-13.9h11.3L39.8 31.9l15 21.6H43.1L32.2 39.2 21.3 53.5H9.6l15-21.6L9.5 10.5Z"
          fill={mono ? 'currentColor' : 'url(#xbar-mark-steel)'}
        />
        <path
          d="M32.2 24.4 43.2 10.5h11.3L39.8 31.9l15 21.6H43.1L32.2 39.2V24.4Z"
          fill={mono ? 'currentColor' : 'url(#xbar-mark-blue)'}
          opacity={mono ? 0.92 : 1}
        />
      </g>
      <path
        d="M20.3 29.8h23.4"
        fill="none"
        stroke={mono ? 'currentColor' : '#3D8EFF'}
        strokeLinecap="round"
        strokeWidth="2.2"
        opacity="0.72"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M27.4 23.7c4.8-6.8 12.5-8 18.2-3.1-4.4.1-7.3 1.6-9.7 5.2"
        fill="none"
        stroke={mono ? 'currentColor' : light ? '#3D8EFF' : '#d9f4ff'}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        opacity="0.86"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx="45.6" cy="20.4" r="1.15" fill={mono ? 'currentColor' : light ? '#3D8EFF' : '#d9f4ff'} opacity="0.9" />
    </svg>
  );
}

export function XbarWordmark({ title = 'XBAR', tone = 'color', ...props }: BrandMarkProps) {
  const mono = tone === 'mono';
  const light = tone === 'light';

  return (
    <svg viewBox="0 0 236 64" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} {...props}>
      {title ? <title>{title}</title> : null}
      <XbarMark x="0" y="0" width="64" height="64" tone={tone} />
      <text
        x="82"
        y="39"
        fill={mono || light ? 'currentColor' : '#f8fbff'}
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
