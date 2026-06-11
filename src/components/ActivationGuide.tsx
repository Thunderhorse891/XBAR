import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { summarizeActivation } from '@/lib/activation';
import { productEvent, productEventNames } from '@/lib/productEvents';
import { trackRuntimeEvent } from '@/lib/runtimeEvents';
import { useCloudStore } from '@/store/useCloudStore';
import { useXbarStore } from '@/store/useXbarStore';
import './ActivationGuide.css';

export function ActivationGuide() {
  const horses = useXbarStore((state) => state.horses.length); const documents = useXbarStore((state) => state.documents.length); const receipts = useXbarStore((state) => state.expenseReceipts.length); const members = useXbarStore((state) => state.workspaceMembers.length); const invitations = useXbarStore((state) => state.workspaceInvitations.length); const sharedListings = useXbarStore((state) => state.sharedListings.filter((listing) => listing.state !== 'Archived').length); const subscription = useXbarStore((state) => state.subscription); const workspaceId = useCloudStore((state) => state.workspaceId);
  const [expanded, setExpanded] = useState(() => localStorage.getItem('xbar-activation-expanded') !== 'false');
  const activation = summarizeActivation({ horses, documents, receipts, members, invitations, sharedListings, monthlyRate: subscription.monthlyRate, billingState: subscription.billingState });

  useEffect(() => {
    if (!activation.firstValueAchieved) return;
    const key = `xbar-first-value-${workspaceId || 'browser'}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, 'true');
    void trackRuntimeEvent({ workspaceId, ...productEvent(productEventNames.activationFirstValueReached, { horses, documents, percent: activation.percent }) });
  }, [activation.firstValueAchieved, activation.percent, documents, horses, workspaceId]);

  const toggle = () => setExpanded((current) => { const next = !current; localStorage.setItem('xbar-activation-expanded', String(next)); void trackRuntimeEvent({ workspaceId, ...productEvent(productEventNames.activationCollapsed, { expanded: next, percent: activation.percent }) }); return next; });
  const trackStep = (stepId: string, path: string) => { void trackRuntimeEvent({ workspaceId, ...productEvent(productEventNames.activationAction, { stepId, path, percent: activation.percent, firstValueAchieved: activation.firstValueAchieved }) }); };
  if (activation.complete) return null;
  if (!expanded) return <section className="activation-compact"><div><strong>{activation.firstValueAchieved ? 'First value reached' : 'Next useful outcome'} · {activation.percent}%</strong><span>{activation.next?.title}</span></div><button className="button button--primary button--compact" type="button" onClick={toggle}>Continue</button></section>;
  return <section className="activation-guide" aria-labelledby="activation-title"><div className="activation-guide__header"><div><span className="activation-guide__eyebrow">First-value command plan</span><h2 id="activation-title">{activation.firstValueAchieved ? 'Your first horse record is taking shape.' : 'Reach the first useful outcome quickly.'}</h2><p>{activation.valueStatement} Then keep adding the operating context that makes XBAR harder to replace.</p></div><div className="activation-guide__score"><strong>{activation.percent}%</strong><span>operational</span><button type="button" onClick={toggle}>Collapse</button></div></div><div className="activation-guide__progress"><span style={{ width: `${activation.percent}%` }} /></div><div className={`activation-value${activation.firstValueAchieved ? ' activation-value--reached' : ''}`}><div><span>{activation.firstValueAchieved ? 'First value reached' : 'First value target'}</span><strong>{activation.firstValueAchieved ? 'One horse now has connected proof.' : 'Connect one horse and one source record.'}</strong><p>{activation.valueStatement}</p></div><Link className="button button--primary button--compact" to={activation.firstValueAchieved ? '/horses' : activation.next?.path ?? '/horses'} onClick={() => trackStep('first-value', activation.firstValueAchieved ? '/horses' : activation.next?.path ?? '/horses')}>{activation.firstValueAchieved ? 'Open horse records' : activation.next?.action}</Link></div><div className="activation-guide__steps">{activation.steps.map((step, index) => <article className={`activation-step${step.complete ? ' activation-step--complete' : step.id === activation.next?.id ? ' activation-step--next' : ''}`} key={step.id}><div className="activation-step__number">{step.complete ? '✓' : index + 1}</div><div className="activation-step__copy"><strong>{step.title}</strong><span>{step.description}</span><small>{step.value}</small></div>{step.complete ? <span className="activation-step__done">Complete</span> : <Link className="button button--ghost button--compact" to={step.path} onClick={() => trackStep(step.id, step.path)}>{step.action}</Link>}</article>)}</div></section>;
}
