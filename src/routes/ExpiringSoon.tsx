import { type CSSProperties, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Upload } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import {
  type DocumentExpiryItem,
  type ExpiryUrgency,
  buildExpiryRadar,
  describeExpiryRisk,
} from '@/lib/documentExpiry';
import { formatDateLabel } from '@/lib/format';
import type { ChipTone } from '@/types/saas';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import './moneyIntelligence.css';

// Stagger index for the motion system; the CSS var drives each child's delay.
const motionIndex = (index: number): CSSProperties => ({ ['--motion-index' as string]: index }) as CSSProperties;

const URGENCY_CHIP: Record<ExpiryUrgency, { tone: ChipTone; label: string }> = {
  expired: { tone: 'danger', label: 'Expired' },
  under30: { tone: 'warning', label: 'Under 30 days' },
  under90: { tone: 'info', label: 'Under 90 days' },
  current: { tone: 'success', label: 'Current' },
  undated: { tone: 'neutral', label: 'No date' },
};

// An expiry is a calendar day. Read at local noon so a 'YYYY-MM-DD' value is
// never shown as the day before in time zones west of UTC.
const dayLabel = (iso: string) => formatDateLabel(`${iso}T12:00:00`);

function whenLabel(item: DocumentExpiryItem) {
  if (item.expiresOn === null || item.daysLeft === null) return 'No expiry date on file';
  if (item.daysLeft < 0) {
    const ago = -item.daysLeft;
    return `Expired ${dayLabel(item.expiresOn)} · ${ago} day${ago === 1 ? '' : 's'} ago`;
  }
  if (item.daysLeft === 0) return `Expires today, ${dayLabel(item.expiresOn)}`;
  return `Expires ${dayLabel(item.expiresOn)} · in ${item.daysLeft} day${item.daysLeft === 1 ? '' : 's'}`;
}

export default function ExpiringSoon() {
  const navigate = useNavigate();
  const openQuickCreate = useUiStore((state) => state.openQuickCreate);
  const documents = useXbarStore((state) => state.documents);
  const horses = useXbarStore((state) => state.horses);

  const radar = useMemo(() => buildExpiryRadar(documents, horses), [documents, horses]);
  const risks = useMemo(() => describeExpiryRisk(radar, horses), [radar, horses]);
  const upload = () => openQuickCreate({ action: 'Upload Document' });

  const head = (
    <PageHead
      eyebrow="Records"
      title="Expiring soon"
      subtitle="Coggins, health certificates, insurance and contracts from your documents, sorted by what runs out first. This page only reads your documents — it never changes one."
      actions={
        <ActionButton variant="primary" icon={<Upload size={15} />} onClick={upload}>
          Upload renewal
        </ActionButton>
      }
    />
  );

  if (!radar.items.length && radar.currentCount === 0) {
    return (
      <>
        {head}
        <Card>
          <div className="xs-empty">
            <span className="xs-empty__icon">
              <CalendarClock size={26} />
            </span>
            <div className="xs-empty__title">
              {documents.length ? 'None of your documents carry an expiry yet' : 'Upload your first Coggins'}
            </div>
            <div className="xs-empty__sub">
              XBAR tracks Coggins (12 months from the test), health certificates, insurance policies and breeding
              contracts. Upload them and this page shows which horses can&apos;t travel or sell, and what runs out next
              — before it costs you a sale or a show.
            </div>
            <ActionButton variant="primary" onClick={upload}>
              Upload documents
            </ActionButton>
          </div>
        </Card>
      </>
    );
  }

  const groups: { key: string; title: string; subtitle: string; items: DocumentExpiryItem[] }[] = [
    {
      key: 'expired',
      title: 'Expired',
      subtitle: 'Past their last good day. Renew these first — already renewed? Archive the old paper in Documents.',
      items: radar.expired,
    },
    {
      key: 'under30',
      title: 'Under 30 days',
      subtitle: 'Book the vet or the renewal now.',
      items: radar.under30,
    },
    { key: 'under90', title: 'Under 90 days', subtitle: 'On the calendar, not urgent yet.', items: radar.under90 },
    {
      key: 'inReview',
      title: 'Waiting in review',
      subtitle: 'Current, but not approved yet. Approve them in Documents so they count.',
      items: radar.inReview,
    },
    {
      key: 'undated',
      title: 'No expiry date on file',
      subtitle: 'XBAR could not find a date on these, so it will not guess one. Check the paper.',
      items: radar.undated,
    },
  ];

  return (
    <>
      {head}

      <div className="fin-hero motion-stagger">
        <div className="fin-stat fin-stat--hero" style={motionIndex(0)}>
          <span className="fin-stat__label">Expired</span>
          <span className="fin-stat__value">{radar.expired.length}</span>
          <span className="fin-stat__sub">
            {radar.expired.length ? 'Renew before these horses travel, show or sell.' : 'Nothing has run out.'}
          </span>
        </div>
        <div className="fin-stat" style={motionIndex(1)}>
          <span className="fin-stat__label">Under 30 days</span>
          <span className="fin-stat__value">{radar.under30.length}</span>
          <span className="fin-stat__sub">Time to book the vet or the renewal.</span>
        </div>
        <div className="fin-stat" style={motionIndex(2)}>
          <span className="fin-stat__label">Under 90 days</span>
          <span className="fin-stat__value">{radar.under90.length}</span>
          <span className="fin-stat__sub">
            {radar.currentCount
              ? `${radar.currentCount} more ${radar.currentCount === 1 ? 'is' : 'are'} current beyond 90 days.`
              : 'Nothing else is on the calendar.'}
          </span>
        </div>
      </div>

      {risks.length ? (
        <Card title="What's at risk" subtitle="From the horse records on file — asking prices and insured values.">
          <div className="fin-insights motion-stagger">
            {risks.map((line, index) => (
              <div key={line} className="fin-insight fin-insight--risk" style={motionIndex(index)}>
                <span className="fin-insight__rail" aria-hidden="true" />
                <div className="fin-insight__title">{line}</div>
                <span />
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {!radar.items.length ? (
        <Card>
          <div className="xs-empty">
            <div className="xs-empty__title">Nothing runs out in the next 90 days</div>
            <div className="xs-empty__sub">
              Every time-sensitive document on file is current. Upload renewals here as they come in and this page keeps
              watching.
            </div>
          </div>
        </Card>
      ) : null}

      {groups
        .filter((group) => group.items.length)
        .map((group) => (
          <Card key={group.key} title={group.title} subtitle={group.subtitle}>
            <div className="xs-mlist">
              {group.items.map((item) => {
                const chip = URGENCY_CHIP[item.urgency];
                return (
                  <div key={item.documentId} className="xs-mrow">
                    <div className="xs-mrow__main">
                      <div className="xs-mrow__title">
                        {item.title} <StatusChip tone={chip.tone}>{item.kind}</StatusChip>
                        {item.reviewed ? null : <StatusChip tone="neutral">Not reviewed yet</StatusChip>}
                      </div>
                      <div className="xs-mrow__detail">
                        {item.horseId ? (
                          <button
                            type="button"
                            className="xs-card__link"
                            onClick={() => navigate(`/horses/${item.horseId}`)}
                          >
                            {item.horseName}
                          </button>
                        ) : (
                          'Ranch-wide'
                        )}{' '}
                        · {whenLabel(item)}
                      </div>
                      <div className="xs-mrow__detail">{item.basis}</div>
                      {item.renewalInReview ? (
                        <div className="xs-mrow__detail">
                          A newer one is waiting in review — approve it in Documents to replace this.
                        </div>
                      ) : null}
                    </div>
                    {item.renewalInReview ? (
                      <ActionButton size="sm" variant="primary" onClick={() => navigate('/documents')}>
                        Review renewal
                      </ActionButton>
                    ) : item.urgency === 'current' ? (
                      <ActionButton size="sm" onClick={() => navigate('/documents')}>
                        Review in Documents
                      </ActionButton>
                    ) : item.urgency === 'undated' ? (
                      <ActionButton size="sm" onClick={() => navigate('/documents')}>
                        Open documents
                      </ActionButton>
                    ) : (
                      <ActionButton
                        size="sm"
                        variant={item.urgency === 'expired' ? 'primary' : undefined}
                        onClick={upload}
                      >
                        Upload renewal
                      </ActionButton>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        ))}
    </>
  );
}
