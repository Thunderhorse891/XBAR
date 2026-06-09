'use client';

import { useState } from 'react';
import { Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { TIER_PRICES, type Tier } from '@/lib/types';

const PLANS: { tier: Tier; name: string; audience: string; features: string[] }[] = [
  {
    tier: 'basic',
    name: 'Basic',
    audience: 'Hobby owners',
    features: ['Up to 5 horses', 'OCR document intake', 'Health & Coggins reminders', 'Document vault (100 docs)', 'Calendar & .ics export'],
  },
  {
    tier: 'pro',
    name: 'Pro',
    audience: 'Breeders & trainers',
    features: ['Up to 25 horses', 'Everything in Basic', 'One-click sale packets', 'Bill of Sale generator', 'Ownership history', '5 team seats'],
  },
  {
    tier: 'business',
    name: 'Business',
    audience: 'Commercial barns',
    features: ['Up to 200 horses', 'Everything in Pro', 'Multi-user roles & invites', 'Owner portal & branding', 'Buyer packet requests', 'Activity audit log'],
  },
];

export function PricingTable({
  currentTier,
  onSelect,
  ctaLabel = 'Start 30-day free trial',
}: {
  currentTier?: Tier;
  onSelect?: (tier: Tier, interval: 'monthly' | 'annual') => void;
  ctaLabel?: string;
}) {
  const [interval, setInterval] = useState<'monthly' | 'annual'>('monthly');

  return (
    <div>
      <div className="mb-6 flex items-center justify-center gap-3">
        <span className={cn('text-sm font-medium', interval === 'monthly' ? 'text-ink' : 'text-steel-muted')}>Monthly</span>
        <button
          type="button"
          role="switch"
          aria-checked={interval === 'annual'}
          aria-label="Toggle annual billing"
          onClick={() => setInterval(interval === 'monthly' ? 'annual' : 'monthly')}
          className={cn(
            'relative h-6 w-11 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            interval === 'annual' ? 'border-accent bg-accent' : 'border-steel bg-steel/40',
          )}
        >
          <span className={cn('absolute top-0.5 h-4.5 w-4.5 h-[18px] w-[18px] rounded-full bg-surface shadow transition-all', interval === 'annual' ? 'left-[22px]' : 'left-0.5')} />
        </button>
        <span className={cn('text-sm font-medium', interval === 'annual' ? 'text-ink' : 'text-steel-muted')}>
          Annual <span className="text-accent-strong">(save ~17%)</span>
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {PLANS.map((plan) => {
          const price = TIER_PRICES[plan.tier][interval];
          const isPro = plan.tier === 'pro';
          const isCurrent = currentTier === plan.tier;
          return (
            <div
              key={plan.tier}
              className={cn(
                'relative flex flex-col rounded-lg border bg-surface p-6 shadow-lift',
                isPro ? 'border-2 border-accent' : 'border-steel/40',
              )}
            >
              {isPro && (
                <Badge variant="blue" className="absolute -top-2.5 left-1/2 -translate-x-1/2">Most popular</Badge>
              )}
              <h3 className="text-lg font-semibold text-ink">{plan.name}</h3>
              <p className="text-xs uppercase tracking-micro text-steel-muted">{plan.audience}</p>
              <p className="mt-4 text-3xl font-bold text-ink">
                ${price}
                <span className="text-sm font-normal text-gunmetal">/mo{interval === 'annual' ? ', billed annually' : ''}</span>
              </p>
              <ul className="mt-5 flex-1 space-y-2.5">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-gunmetal">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-accent-strong" aria-hidden /> {feature}
                  </li>
                ))}
              </ul>
              <Button
                className="mt-6 w-full"
                variant={isPro ? 'primary' : 'outline'}
                disabled={isCurrent}
                title={isCurrent ? 'This is your current plan.' : undefined}
                onClick={() => onSelect?.(plan.tier, interval)}
              >
                {isCurrent ? 'Current plan' : ctaLabel}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
