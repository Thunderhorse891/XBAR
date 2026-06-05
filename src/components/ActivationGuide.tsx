import { useState } from 'react';
import { Link } from 'react-router-dom';
import { summarizeActivation } from '@/lib/activation';
import { useXbarStore } from '@/store/useXbarStore';
import './ActivationGuide.css';

export function ActivationGuide() {
  const horses = useXbarStore((state) => state.horses.length); const documents = useXbarStore((state) => state.documents.length); const receipts = useXbarStore((state) => state.expenseReceipts.length); const members = useXbarStore((state) => state.workspaceMembers.length); const invitations = useXbarStore((state) => state.workspaceInvitations.length); const sharedListings = useXbarStore((state) => state.sharedListings.filter((listing) => listing.state !== 'Archived').length); const subscription = useXbarStore((state) => state.subscription);
  const [expanded, setExpanded] = useState(() => localStorage.getItem('xbar-activation-expanded') !== 'false');
  const activation = summarizeActivation({ horses, documents, receipts, members, invitations, sharedListings, monthlyRate: subscription.monthlyRate, billingState: subscription.billingState });
  const toggle = () => setExpanded((current) => { const next = !current; localStorage.setItem('xbar-activation-expanded', String(next)); return next; });
  if (activation.complete) return null;
  if (!expanded) return <section className="activation-compact"><div><strong>Ranch activation: {activation.percent}%</strong><span>{activation.next?.title}</span></div><button className="button button--primary button--compact" type="button" onClick={toggle}>Continue setup</button></section>;
  return <section className="activation-guide" aria-labelledby="activation-title"><div className="activation-guide__header"><div><span className="activation-guide__eyebrow">First-run command plan</span><h2 id="activation-title">Turn this workspace into an operating advantage.</h2><p>{activation.completed} of {activation.total} activation milestones complete. Each completed step makes the ranch record more useful and harder to replace.</p></div><div className="activation-guide__score"><strong>{activation.percent}%</strong><span>activated</span><button type="button" onClick={toggle}>Collapse</button></div></div><div className="activation-guide__progress"><span style={{ width: `${activation.percent}%` }} /></div><div className="activation-guide__steps">{activation.steps.map((step, index) => <article className={`activation-step${step.complete ? ' activation-step--complete' : step.id === activation.next?.id ? ' activation-step--next' : ''}`} key={step.id}><div className="activation-step__number">{step.complete ? '✓' : index + 1}</div><div className="activation-step__copy"><strong>{step.title}</strong><span>{step.description}</span><small>{step.value}</small></div>{step.complete ? <span className="activation-step__done">Complete</span> : <Link className="button button--ghost button--compact" to={step.path}>{step.action}</Link>}</article>)}</div></section>;
}
