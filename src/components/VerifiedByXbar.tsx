import { BadgeCheck } from 'lucide-react';
import './verifiedByXbar.css';

/**
 * The "seal verified" trust pill. Renders a green badge that says
 * "✓ Seal verified by XBAR · SEAL-…". When `href` is given it links to the public
 * verification page (so the badge can travel into listings and pull buyers
 * back); otherwise it renders as a static confirmation (e.g. on the verify page
 * itself). It asserts only that the seal verified — the packet is unaltered
 * since sealing — never an appraisal.
 */
export function VerifiedByXbar({
  sealCode,
  href,
  size = 'md',
}: {
  sealCode?: string;
  href?: string;
  size?: 'sm' | 'md';
}) {
  const label = sealCode ? `Seal verified by XBAR · ${sealCode}` : 'XBAR seal · unaltered';
  const className = `xbar-verified xbar-verified--${size}`;
  const content = (
    <>
      <BadgeCheck size={size === 'sm' ? 14 : 16} aria-hidden="true" />
      <span>{label}</span>
    </>
  );

  if (href) {
    return (
      <a className={className} href={href} target="_blank" rel="noopener noreferrer">
        {content}
      </a>
    );
  }
  return <span className={className}>{content}</span>;
}
