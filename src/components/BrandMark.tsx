import type { SVGProps } from 'react';
import '../../public/brand/xbar-signature.css';

type BrandMarkProps = SVGProps<SVGSVGElement> & {
  title?: string;
  tone?: 'color' | 'mono';
};
export const XBAR_MAIN_LOGO_SRC = `${import.meta.env.BASE_URL}brand/xbar-original-lockup-480.png`;

/** Owner-selected original B: complete, uncropped artwork, never a redraw. */
export function XbarMark({
  title,
  tone: _tone = 'color',
  className = '',
  width = 72,
  height = 41,
  ...props
}: BrandMarkProps) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 1672 941"
      preserveAspectRatio="xMidYMid meet"
      className={`xbar-signature ${className}`.trim()}
      data-xbar-signature=""
      data-original-artwork="B"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <image
        className="xbar-signature__original"
        href={XBAR_MAIN_LOGO_SRC}
        x="0"
        y="0"
        width="1672"
        height="941"
        preserveAspectRatio="xMidYMid meet"
      />
    </svg>
  );
}

export function XbarWordmark(props: BrandMarkProps) {
  return <XbarMark {...props} />;
}
