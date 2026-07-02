import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { ActionButton, PageHead } from '@/components/saas';
import { formatCurrency } from '@/lib/format';
import { revenuePlanMatrix } from '@/lib/revenuePlanMatrix';
import { subscriptionPlans } from '@/lib/subscriptionPlans';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import { events, track } from '@/lib/telemetry';
import type { SubscriptionTier } from '@/types/xbar';

const tiers: SubscriptionTier[] = ['Starter', 'Professional', 'Ranch Ops', 'Enterprise'];

export default function Plans() {
  const navigate = useNavigate();
  const pushToast = useUiStore((s) => s.pushToast);
  const subscription = useXbarStore((s) => s.subscription);
  const [billing, setBilling] = useState<'mo' | 'yr'>('mo');

  return (
    <>
      <PageHead
        eyebrow="Account"
        title="Choose a plan"
        subtitle="Pick the plan that matches your horse count, documents, team seats, and buyer follow-up needs."
        actions={
          <div className="xs-toggle" role="tablist" aria-label="Billing period">
            <button type="button" className={`xs-toggle__btn${billing === 'mo' ? ' xs-toggle__btn--active' : ''}`} onClick={() => setBilling('mo')}>Monthly</button>
            <button type="button" className={`xs-toggle__btn${billing === 'yr' ? ' xs-toggle__btn--active' : ''}`} onClick={() => setBilling('yr')}>Yearly, save 2 months</button>
          </div>
        }
      />

      <div className="xs-plangrid">
        {tiers.map((tier) => {
          const plan = subscriptionPlans[tier];
          const profile = revenuePlanMatrix[tier];
          const isCurrent = subscription.tier === tier;
          const price = billing === 'yr' ? formatCurrency(plan.monthlyRate * 10) : formatCurrency(plan.monthlyRate);
          const cadence = billing === 'yr' ? '/yr' : '/mo';
          const featured = tier === 'Ranch Ops';
          return (
            <div key={tier} className={`xs-plancard${featured ? ' xs-plancard--featured' : ''}`}>
              <div className="xs-plancard__name">{tier}</div>
              <div className="xs-plancard__price">{price}<small>{cadence}</small></div>
              <div className="xs-card__sub">{profile.fit}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                {plan.featureFlags.map((feature) => (
                  <div key={feature} className="xs-plancard__feat"><Check size={14} /> {feature}</div>
                ))}
              </div>
              {isCurrent ? (
                <span className="xs-chip xs-chip--success" style={{ justifyContent: 'center' }}>Current plan</span>
              ) : (
                <ActionButton
                  variant={featured ? 'primary' : 'default'}
                  block
                  onClick={() => {
                    track(events.planSelected, { plan: tier });
                    pushToast({ title: 'Plan selected', message: `${tier} plan selected.`, tone: 'success' });
                    navigate(`/subscriptions?plan=${encodeURIComponent(tier)}`);
                  }}
                >
                  Choose {tier}
                </ActionButton>
              )}
            </div>
          );
        })}
      </div>

      <button type="button" className="xs-back" onClick={() => navigate('/subscriptions')} style={{ marginTop: 4 }}>Open checkout and invoices</button>
    </>
  );
}
