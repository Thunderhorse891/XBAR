import { formatCurrency } from '@/lib/format';
import { isCompedEmail } from '@/lib/compAccess';
import { subscriptionPlans } from '@/lib/subscriptionPlans';
import { useCloudStore } from '@/store/useCloudStore';
import { useXbarStore } from '@/store/useXbarStore';
import { useUiStore } from '@/store/useUiStore';
import type { SubscriptionTier } from '@/types/xbar';
import './ownerTierSwitcher.css';

const TIERS: SubscriptionTier[] = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];

// Owner / QA tier preview.
//
// An allowlisted operator email (VITE_XBAR_COMP_EMAILS — see compAccess.ts) can
// switch the active subscription tier instantly, with no checkout, so the owner
// can touch and see every tier's features and gates for quality control. This is
// a local preview switch: it drives the client-side gating exactly as a real
// customer on that tier would experience it, without changing billing. It renders
// nothing for anyone who is not on the comp allowlist.
export function OwnerTierSwitcher() {
  const sessionEmail = useCloudStore((state) => state.session?.user?.email ?? '');
  const tier = useXbarStore((state) => state.subscription.tier);
  const applySubscriptionTier = useXbarStore((state) => state.applySubscriptionTier);
  const pushToast = useUiStore((state) => state.pushToast);

  if (!isCompedEmail(sessionEmail)) {
    return null;
  }

  const selectTier = (next: SubscriptionTier) => {
    if (next === tier) return;
    const result = applySubscriptionTier(next, { billingState: 'Manual Billing' });
    pushToast({
      title: result.ok ? `Previewing ${next}` : 'Could not switch tier',
      message: result.ok
        ? `Every feature and limit now reflects the ${next} tier. No billing was changed.`
        : result.message,
      tone: result.ok ? 'success' : 'warning',
    });
  };

  return (
    <section className="owner-tier-switcher" aria-label="Owner tier preview">
      <div className="owner-tier-switcher__intro">
        <span className="owner-tier-switcher__badge">Owner preview</span>
        <h2>Touch &amp; see every tier</h2>
        <p>
          Switch the active tier instantly to quality-check what each plan unlocks. This changes the live app for your
          workspace only and never charges a card or alters real billing.
        </p>
      </div>
      <div className="owner-tier-switcher__options" role="group" aria-label="Choose a tier to preview">
        {TIERS.map((option) => {
          const config = subscriptionPlans[option];
          const active = option === tier;
          return (
            <button
              key={option}
              type="button"
              className={`owner-tier-switcher__option${active ? ' owner-tier-switcher__option--active' : ''}`}
              aria-pressed={active}
              onClick={() => selectTier(option)}
            >
              <strong>{option}</strong>
              <span>{formatCurrency(config.monthlyRate)}/mo</span>
              <small>
                {config.limits.horseLimit.toLocaleString()} horses · {config.limits.seatLimit.toLocaleString()} seats
              </small>
              {active ? <em className="owner-tier-switcher__flag">Active now</em> : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

export default OwnerTierSwitcher;
