import { useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { Card, PageHead, ProgressRing } from '@/components/saas';
import { billingPath } from '@/lib/billingRoutes';
import { useXbarStore } from '@/store/useXbarStore';

type Step = {
  id: string;
  title: string;
  detail: string;
  done: boolean;
  action: string;
  to: string;
};

export default function GettingStarted() {
  const navigate = useNavigate();
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const salePacketBuilds = useXbarStore((state) => state.salePacketBuilds);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const subscription = useXbarStore((state) => state.subscription);

  const documentsToCheck = documents.filter(
    (document) => document.state === 'Needs Review' || document.state === 'Matched',
  ).length;
  const steps: Step[] = [
    {
      id: 'workspace',
      title: 'Name your ranch',
      detail: workspaceProfile.ranchName ? workspaceProfile.ranchName : 'Add the ranch name people should see.',
      done: Boolean(workspaceProfile.ranchName),
      action: 'Open settings',
      to: '/settings',
    },
    {
      id: 'horse',
      title: 'Add your first horse',
      detail: horses.length
        ? `${horses.length} horse${horses.length === 1 ? '' : 's'} in this workspace.`
        : 'Start with the horse you work with most.',
      done: horses.length > 0,
      action: horses.length ? 'View horses' : 'Add horse',
      to: horses.length ? '/horses' : '/horses?new=1',
    },
    {
      id: 'documents',
      title: 'Upload documents',
      detail: documents.length
        ? `${documents.length} document${documents.length === 1 ? '' : 's'} uploaded.`
        : 'Upload Coggins, registration, health records, or bills of sale.',
      done: documents.length > 0,
      action: 'Upload',
      to: '/documents?upload=1',
    },
    {
      id: 'review',
      title: 'Review uploaded documents',
      detail: documents.length
        ? `${documentsToCheck} item${documentsToCheck === 1 ? '' : 's'} still need checking.`
        : 'Review starts after the first upload.',
      done: documents.length > 0 && documentsToCheck === 0,
      action: 'Review',
      to: '/documents',
    },
    {
      id: 'sale-packets',
      title: 'Prepare sale packet',
      detail: salePacketBuilds.length
        ? `${salePacketBuilds.length} set${salePacketBuilds.length === 1 ? '' : 's'} prepared.`
        : 'Choose the records a buyer can see before a sale.',
      done: salePacketBuilds.length > 0,
      action: 'Prepare',
      to: '/sale-packets',
    },
    {
      id: 'buyer',
      title: 'Track buyer follow-up',
      detail: salesLeads.length
        ? `${salesLeads.length} buyer${salesLeads.length === 1 ? '' : 's'} in sales.`
        : 'Add buyer notes, offers, and next follow-up dates.',
      done: salesLeads.length > 0,
      action: 'Open sales',
      to: '/sales',
    },
    {
      id: 'plan',
      title: 'Review billing',
      detail: `${subscription.tier} billing is set for this workspace.`,
      done: subscription.billingState === 'Active' || subscription.monthlyRate > 0,
      action: 'Open billing',
      to: billingPath,
    },
  ];

  const doneCount = steps.filter((s) => s.done).length;
  const progress = Math.round((doneCount / steps.length) * 100);

  return (
    <>
      <PageHead
        eyebrow="Setup"
        title="Getting started"
        subtitle="Use real workspace activity to see what is ready and what still needs attention."
      />

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <ProgressRing value={progress} size={56} />
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'var(--xbar-font-display)', fontSize: 24, fontWeight: 600 }}>
              {progress}% set up
            </div>
            <div className="xs-card__sub">
              {doneCount} of {steps.length} steps are complete.
            </div>
          </div>
          <button type="button" className="xs-btn xs-btn--primary" onClick={() => navigate('/horses?new=1')}>
            Add horse
          </button>
        </div>
      </Card>

      <div className="xs-checklist">
        {steps.map((s) => (
          <div key={s.id} className={`xs-checkitem${s.done ? ' xs-checkitem--done' : ''}`}>
            <span className={`xs-check${s.done ? ' xs-check--done' : ''}`} aria-label={s.done ? 'Done' : 'Not done'}>
              {s.done ? <Check size={15} /> : null}
            </span>
            <div className="xs-checkitem__body">
              <div className="xs-checkitem__title">{s.title}</div>
              <div className="xs-checkitem__sub">{s.detail}</div>
            </div>
            <button type="button" className="xs-btn xs-btn--sm" onClick={() => navigate(s.to)}>
              {s.action}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
