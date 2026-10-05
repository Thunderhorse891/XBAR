import { Link } from 'react-router-dom';
import { Panel } from '@/components/app-ui';
import { RANCH_SOCIAL_PLATFORMS, normalizeRanchSocialLinks } from '@/lib/ranchSocialLinks';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';

export function RanchSocialLinksPanel() {
  const profile = useXbarStore((s) => s.workspaceProfile);
  const canManage = useCurrentRoleCapability('manageSettings');
  const links = normalizeRanchSocialLinks(profile.socialLinks);
  return (
    <Panel eyebrow="Your ranch" title="Ranch social profiles">
      <p>Open your ranch’s public profiles. These links do not sign in or give XBAR posting access.</p>
      {!Object.keys(links).length ? <p>No social profiles saved for this ranch yet.</p> : null}
      <div className="inline-actions">
        {RANCH_SOCIAL_PLATFORMS.filter(({ key }) => links[key]).map(({ key, label }) => (
          <a
            className="button button--ghost button--compact"
            key={key}
            href={links[key]}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open {label} profile
          </a>
        ))}
        {canManage ? (
          <Link className="button button--primary button--compact" to="/settings#ranch-social-profiles">
            Manage social links
          </Link>
        ) : (
          <p>Ask a ranch admin to update these links.</p>
        )}
      </div>
    </Panel>
  );
}
