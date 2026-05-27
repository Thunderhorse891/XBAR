import type { SVGProps } from 'react';

type BrandMarkProps = SVGProps<SVGSVGElement> & {
  title?: string;
  tone?: 'color' | 'mono';
};

export function XbarMark({ title, tone = 'color', ...props }: BrandMarkProps) {
  const mono = tone === 'mono';

  return (
    <svg viewBox="0 0 64 64" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} {...props}>
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient id="xbar-mark-steel" x1="9" x2="55" y1="7" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f8fbff" />
          <stop offset="0.42" stopColor="#8fa5b8" />
          <stop offset="1" stopColor="#253241" />
        </linearGradient>
        <linearGradient id="xbar-mark-blue" x1="19" x2="49" y1="13" y2="53" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8edcff" />
          <stop offset="0.5" stopColor="#2f8dff" />
          <stop offset="1" stopColor="#1649ff" />
        </linearGradient>
        <filter id="xbar-mark-glow" x="-30%" y="-30%" width="160%" height="160%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="1.6" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g fill="none" stroke={mono ? 'currentColor' : 'rgba(248,251,255,0.62)'} strokeWidth="1.15" vectorEffect="non-scaling-stroke">
        <path d="M11 16.5 25.8 32 11 47.5" opacity="0.45" />
        <path d="M53 16.5 38.2 32 53 47.5" opacity="0.45" />
      </g>
      <g filter={mono ? undefined : 'url(#xbar-mark-glow)'}>
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
        stroke={mono ? 'currentColor' : '#f4f8ff'}
        strokeLinecap="round"
        strokeWidth="2.2"
        opacity="0.72"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M27.4 23.7c4.8-6.8 12.5-8 18.2-3.1-4.4.1-7.3 1.6-9.7 5.2"
        fill="none"
        stroke={mono ? 'currentColor' : '#d9f4ff'}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
        opacity="0.86"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx="45.6" cy="20.4" r="1.15" fill={mono ? 'currentColor' : '#d9f4ff'} opacity="0.9" />
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
        fontFamily="Inter, Segoe UI, Arial, sans-serif"
        fontSize="28"
        fontWeight="800"
        letterSpacing="5.8"
      >
        XBAR
      </text>
      <path d="M84 49.5h126" stroke={mono ? 'currentColor' : '#3f8cff'} strokeLinecap="round" strokeWidth="1.5" opacity="0.58" />
    </svg>
  );
}
