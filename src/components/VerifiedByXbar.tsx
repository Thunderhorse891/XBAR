import { BadgeCheck } from 'lucide-react';
import './verifiedByXbar.css';

/**
 * The "Verified by XBAR" trust pill. Renders a green badge that says
 * "✓ Verified by XBAR · SEAL-…". When `href` is given it links to the public
 * verification page (so the badge can travel into listings and pull buyers
 * back); otherwise it renders as a static confirmation (e.g. on the verify page
 * itself). It asserts only that a packet is verifiable/unaltered — never an
 * appraisal.
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
  const label = sealCode ? `Verified by XBAR · ${sealCode}` : 'Verified by XBAR';
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
