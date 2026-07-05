import { Link } from 'react-router-dom';
import { Panel, Pill } from '@/components/app-ui';
import { buildBuyerDealRoomSummaries } from '@/lib/buyerDealRoom';
import { formatCompactCurrency, formatDateLabel } from '@/lib/format';
import { useXbarStore } from '@/store/useXbarStore';

function actionTone(tone: 'blue' | 'amber' | 'rose' | 'emerald' | 'slate') {
  return tone;
}

export function BuyerDealRoomPanel({ compact = false }: { compact?: boolean }) {
  const horses = useXbarStore((state) => state.horses);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const buyerRoomEvents = useXbarStore((state) => state.buyerRoomEvents);
  const summaries = buildBuyerDealRoomSummaries({ horses, leads: salesLeads, events: buyerRoomEvents });
  const visibleSummaries = compact ? summaries.slice(0, 4) : summaries.slice(0, 8);
  const activeQuestionCount = summaries.reduce((total, summary) => total + summary.openQuestions, 0);
  const highestOffer = summaries.reduce((highest, summary) => Math.max(highest, summary.highestOffer), 0);
  const packetDownloadCount = summaries.reduce((total, summary) => total + summary.packetDownloads, 0);

  return (
    <Panel
      eyebrow="Buyer Deal Room"
      title="Deal pressure"
      description={compact ? undefined : 'Buyer activity by horse: unanswered questions, document requests, packet downloads, open offers, latest status, and the next seller action.'}
      meta={<Pill tone={activeQuestionCount ? 'amber' : highestOffer || packetDownloadCount ? 'blue' : 'slate'}>{activeQuestionCount ? `${activeQuestionCount} response needed` : highestOffer ? 'Offer pressure' : packetDownloadCount ? `${packetDownloadCount} packet download${packetDownloadCount === 1 ? '' : 's'}` : 'Quiet'}</Pill>}
      action={<Link className="button button--ghost button--compact" to="/documents?packet=1">Build a buyer packet</Link>}
    >
      {visibleSummaries.length ? (
        <div className="stack-list">
          {visibleSummaries.map((summary) => (
            <Link key={summary.horseId} to={`/horses/${summary.horseId}`} className="stack-item stack-item--interactive">
              <div className="stack-item__top">
                <div>
                  <div className="stack-item__title">{summary.horseName}</div>
                  <div className="stack-item__copy">
                    {summary.eventCount} buyer event{summary.eventCount === 1 ? '' : 's'} · {summary.packetDownloads} packet download{summary.packetDownloads === 1 ? '' : 's'} · {summary.offers} offer{summary.offers === 1 ? '' : 's'} · {summary.latestActivityAt ? `Last ${formatDateLabel(summary.latestActivityAt)}` : 'No activity yet'}
                  </div>
                </div>
                <Pill tone={actionTone(summary.action.tone)}>{summary.action.label}</Pill>
              </div>
              <div className="inline-metrics">
                <span>Ask {formatCompactCurrency(summary.askPrice)}</span>
                <span>High offer {summary.highestOffer ? formatCompactCurrency(summary.highestOffer) : 'none'}</span>
                <span>{summary.openQuestions} open request{summary.openQuestions === 1 ? '' : 's'}</span>
              </div>
              {!compact ? <div className="stack-item__copy" style={{ marginTop: 8 }}>{summary.action.reason}</div> : null}
            </Link>
          ))}
        </div>
      ) : (
        <div className="stack-list">
          <div className="stack-item">
            <div className="stack-item__title">No buyer activity yet</div>
            <div className="stack-item__copy">
              Pick a horse, build its buyer packet, and share it — buyer questions, downloads, and offers will show up here.
            </div>
            <div className="inline-actions" style={{ marginTop: 10 }}>
              <Link className="button button--primary button--compact" to="/documents?packet=1">Build a buyer packet</Link>
            </div>
          </div>
        </div>
      )}
    </Panel>
  );
}
