import { useEffect, useRef, type SVGProps } from 'react';
import geometry from '../../public/brand/xbar-signature-paths.json';
import { installSignatureMotion } from '../lib/signatureMotion';
import '../../public/brand/xbar-signature.css';

type BrandMarkProps = SVGProps<SVGSVGElement> & { title?: string; tone?: 'color' | 'mono' };
const paths = geometry.compactPaths as readonly { id: string; d: string; fillRule: 'evenodd' | 'nonzero' }[];
export const XBAR_MAIN_LOGO_SRC = '/brand/xbar-signature-horse-silhouette.svg';

/** The same supplied-horse geometry used by the public site and static exports. */
export function XbarMark({ title, tone = 'color', className = '', width = 32, height = 32, ...props }: BrandMarkProps) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    const motion = installSignatureMotion(ref.current);
    return () => motion.dispose();
  }, []);
  return (
    <svg
      ref={ref}
      width={width}
      height={height}
      viewBox={geometry.compactViewBox}
      className={`xbar-signature ${className}`.trim()}
      data-xbar-signature=""
      data-tone={tone}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <g className="xbar-signature__base" aria-hidden="true">
        {paths.map((path) => (
          <path key={path.id} d={path.d} fillRule={path.fillRule} />
        ))}
      </g>
      <g aria-hidden="true">
        {paths.map((path) => (
          <path className="xbar-signature__trace" key={path.id} d={path.d} pathLength="1" />
        ))}
      </g>
    </svg>
  );
}

/** Compatibility export: recognition comes from the horse, not a font-built substitute wordmark. */
export function XbarWordmark(props: BrandMarkProps) {
  return <XbarMark {...props} />;
}
