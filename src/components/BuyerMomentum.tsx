import { Link } from 'react-router-dom';
import { Pill } from '@/components/app-ui';
import { followUpTiming, sortFollowUps } from '@/lib/salesFollowUp';
import { formatCompactCurrency, formatDateLabel } from '@/lib/format';
import { productEvent, productEventNames } from '@/lib/productEvents';
import { trackRuntimeEvent } from '@/lib/runtimeEvents';
import { useCloudStore } from '@/store/useCloudStore';
import { useXbarStore } from '@/store/useXbarStore';
import './BuyerMomentum.css';

export function BuyerMomentum() {
  const salesLeads = useXbarStore((state) => state.salesLeads); const horses = useXbarStore((state) => state.horses); const workspaceId = useCloudStore((state) => state.workspaceId); const leads = sortFollowUps([...salesLeads]);
  if (!leads.length) return null;
  const urgent = leads.filter((lead) => ['Overdue', 'Today'].includes(followUpTiming(lead))).length; const offers = leads.filter((lead) => lead.stage === 'Offer'); const offerValue = offers.reduce((sum, lead) => sum + (lead.offerAmount ?? 0), 0);
  const trackOpen = (source: string, leadId?: string) => { void trackRuntimeEvent({ workspaceId, ...productEvent(productEventNames.buyerMomentumOpened, { source, leadId: leadId ?? '', urgentCount: urgent, offerCount: offers.length }) }); };
  return <section className="buyer-momentum" aria-labelledby="buyer-momentum-title"><div className="buyer-momentum__summary"><div><span className="buyer-momentum__eyebrow">Buyer momentum</span><h2 id="buyer-momentum-title">{urgent ? `${urgent} buyer touch${urgent === 1 ? '' : 'es'} need attention` : 'Buyer follow-ups are on schedule'}</h2><p>Protect active offers and keep every warm buyer moving toward a decision.</p></div><div className="buyer-momentum__stats"><div><span>Due now</span><strong>{urgent}</strong></div><div><span>Active offers</span><strong>{offers.length}</strong></div><div><span>Offer value</span><strong>{formatCompactCurrency(offerValue)}</strong></div></div><Link className="button button--primary" to="/follow-ups" onClick={() => trackOpen('command_center_cta')}>Open buyer follow-ups</Link></div><div className="buyer-momentum__rail">{leads.slice(0, 3).map((lead) => { const timing = followUpTiming(lead); const horse = horses.find((item) => item.id === lead.horseId); return <Link key={lead.id} className="buyer-momentum__lead" to={`/follow-ups?lead=${lead.id}`} onClick={() => trackOpen('command_center_lead', lead.id)}><span><strong>{lead.name}</strong><small>{horse?.name ?? 'Horse pending'} | {lead.channel}</small></span><span><Pill tone={timing === 'Overdue' ? 'rose' : timing === 'Today' ? 'amber' : lead.stage === 'Offer' ? 'emerald' : 'blue'}>{timing === 'Upcoming' ? lead.stage : timing}</Pill><small>{lead.nextFollowUp ? formatDateLabel(lead.nextFollowUp) : 'Schedule next touch'}</small></span></Link>; })}</div></section>;
}
