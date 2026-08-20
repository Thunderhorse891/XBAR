import { PREVIEWABLE_TIERS, ownerPreviewReachDetail, ownerPreviewReachLabel } from '@/lib/ownerPreview';
import { useOwnerPreview } from '@/hooks/useOwnerPreview';
import { useOwnerPreviewStore } from '@/store/useOwnerPreviewStore';
import './ownerTestModeBar.css';

/*
 * Persistent owner test-mode indicator.
 *
 * Renders nothing at all for anyone who is not authorized, so a normal customer
 * never sees it. For an authorized owner it stays on screen for as long as a
 * preview is possible — not just while one is active — because the failure this
 * guards against is forgetting which tier you are looking at and reading a
 * gated screen as though it were your real plan.
 *
 * It shows three things a preview needs to be honest:
 *   - that this is a preview and which tier is being previewed,
 *   - how far that tier actually reaches (local-only vs cloud-backed), since a
 *     local dev preview cannot perform cloud actions at the previewed tier,
 *   - the real plan, and one control to go back to it.
 */
export function OwnerTestModeBar() {
  const { authorization, previewing, reach, realSubscription, effectiveSubscription } = useOwnerPreview();
  const setPreviewTier = useOwnerPreviewStore((state) => state.setPreviewTier);
  const clearPreview = useOwnerPreviewStore((state) => state.clearPreview);

  if (!authorization.authorized) return null;

  const reachLabel = ownerPreviewReachLabel(reach);

  return (
    <aside
      className={`owner-test-bar${previewing ? ' owner-test-bar--previewing' : ''}`}
      aria-label="Owner test mode"
      data-reach={reach}
    >
      <div className="owner-test-bar__status">
        <span className="owner-test-bar__badge">Owner test mode</span>
        <span className="owner-test-bar__reach" title={ownerPreviewReachDetail(reach)}>
          {reachLabel}
        </span>
        <span className="owner-test-bar__plan">
          {previewing
            ? `Previewing ${effectiveSubscription.tier} · real plan ${realSubscription.tier}`
            : `Real plan ${realSubscription.tier}`}
        </span>
      </div>

      <div className="owner-test-bar__tiers" role="group" aria-label="Preview a tier">
        {PREVIEWABLE_TIERS.map((tier) => {
          const active = effectiveSubscription.tier === tier;
          return (
            <button
              key={tier}
              type="button"
              className="owner-test-bar__tier"
              aria-pressed={active}
              onClick={() => setPreviewTier(tier)}
            >
              {tier}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        className="owner-test-bar__reset"
        onClick={() => clearPreview()}
        // Always enabled: the real plan is never overwritten, so returning to
        // it is always available and always safe, even mid-preview.
      >
        {`Return to real plan (${realSubscription.tier})`}
      </button>

      <p className="owner-test-bar__detail">{ownerPreviewReachDetail(reach)}</p>
    </aside>
  );
}

export default OwnerTestModeBar;
