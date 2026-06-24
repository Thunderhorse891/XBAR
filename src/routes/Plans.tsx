import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { ActionButton, PageHead } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import { subscriptionPlanCards } from '@/data/xbarSaasMock';

export default function Plans() {
  const navigate = useNavigate();
  const pushToast = useUiStore((s) => s.pushToast);
  const currentTier = useXbarStore((s) => s.subscription?.tier);
  const [billing, setBilling] = useState<'mo' | 'yr'>('mo');

  return (
    <>
      <PageHead
        eyebrow="Account"
        title="Plans & Upgrade"
        subtitle="Scale XBAR with your operation — from basic records to buyer deal rooms and white-glove infrastructure."
        actions={
          <div className="xs-toggle" role="tablist" aria-label="Billing period">
            <button type="button" className={`xs-toggle__btn${billing === 'mo' ? ' xs-toggle__btn--active' : ''}`} onClick={() => setBilling('mo')}>Monthly</button>
            <button type="button" className={`xs-toggle__btn${billing === 'yr' ? ' xs-toggle__btn--active' : ''}`} onClick={() => setBilling('yr')}>Yearly · save 2mo</button>
          </div>
        }
      />

      <div className="xs-plangrid">
        {subscriptionPlanCards.map((p) => {
          const isCurrent = currentTier === p.name;
          const yearly = p.price.startsWith('$') ? `$${Number(p.price.replace(/\D/g, '')) * 10}` : p.price;
          return (
            <div key={p.name} className={`xs-plancard${p.featured ? ' xs-plancard--featured' : ''}`}>
              <div className="xs-plancard__name">{p.name}</div>
              <div className="xs-plancard__price">{billing === 'yr' ? yearly : p.price}{p.cadence ? <small>{billing === 'yr' ? '/yr' : p.cadence}</small> : null}</div>
              <div className="xs-card__sub">{p.summary}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                {p.features.map((f) => (
                  <div key={f} className="xs-plancard__feat"><Check size={14} /> {f}</div>
                ))}
              </div>
              {isCurrent ? (
                <span className="xs-chip xs-chip--success" style={{ justifyContent: 'center' }}>Current plan</span>
              ) : (
                <ActionButton variant={p.featured ? 'primary' : 'default'} block onClick={() => { pushToast({ title: 'Upgrade', message: `${p.name} selected`, tone: 'success' }); navigate('/subscriptions'); }}>
                  {p.price === 'Custom' ? 'Contact Sales' : `Choose ${p.name}`}
                </ActionButton>
              )}
            </div>
          );
        })}
      </div>

      <button type="button" className="xs-back" onClick={() => navigate('/subscriptions')} style={{ marginTop: 4 }}>Manage billing & invoices →</button>
    </>
  );
}
