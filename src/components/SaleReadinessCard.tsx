import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, FileText } from 'lucide-react';
import { ActionButton, Card, ProgressRing, StatusChip } from '@/components/saas';
import { ProgressBar } from '@/components/app-ui';
import {
  PROOF_PACKET_THRESHOLD,
  READINESS_ACTION_CAPABILITY,
  type ReadinessAction,
  type SaleReadinessScore,
  readinessHeadline,
} from '@/lib/saleReadinessScore';
import { getCapabilityDeniedMessage, hasRoleCapability } from '@/lib/permissions';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';

/**
 * The computed sale readiness score on a horse profile: the score, the three
 * moves that raise it most, and the proof packet once it is earned.
 *
 * `detailed` adds the per-component breakdown for the Ready to Sell tab.
 */
export function SaleReadinessCard({
  horseId,
  readiness,
  onAddPhoto,
  detailed = false,
}: {
  horseId: string;
  readiness: SaleReadinessScore;
  /** Opens the profile's photo picker; absent when this role cannot upload media. */
  onAddPhoto?: () => void;
  detailed?: boolean;
}) {
  const navigate = useNavigate();
  const openQuickCreate = useUiStore((state) => state.openQuickCreate);

  const run = (action: ReadinessAction) => {
    switch (action.target) {
      case 'edit-horse':
        openQuickCreate({ action: 'Edit Horse', horseId });
        return;
      case 'upload-document':
        openQuickCreate({ action: 'Upload Document', horseId });
        return;
      case 'review-documents':
        navigate('/documents');
        return;
      case 'add-photo':
        onAddPhoto?.();
        return;
      case 'care':
        navigate(`/expenses?log=${encodeURIComponent(action.logCategory ?? 'Wormer')}&horse=${horseId}`);
        return;
      case 'ownership':
        navigate('/ownership');
        return;
    }
  };

  const headline = readinessHeadline(readiness);
  // A step the current role cannot finish is greyed out and says why, rather
  // than opening a form this role can only read.
  const currentRole = useXbarStore((state) => state.currentRole);
  const allowed = (action: ReadinessAction) =>
    hasRoleCapability(currentRole, READINESS_ACTION_CAPABILITY[action.target]);
  const deniedMessages = [
    ...new Set(
      readiness.topActions
        .filter((action) => !allowed(action))
        .map((action) => getCapabilityDeniedMessage(READINESS_ACTION_CAPABILITY[action.target])),
    ),
  ];

  return (
    <Card
      title="Sale readiness"
      subtitle="Horses with complete, verified records sell faster and higher."
      link={detailed ? 'Open sale packets' : undefined}
      onLink={detailed ? () => navigate('/sale-packets') : undefined}
    >
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <ProgressRing value={readiness.score} size={64} />
          <div>
            <div style={{ fontFamily: 'var(--xbar-font-display)', fontSize: 34, fontWeight: 700, lineHeight: 1 }}>
              {readiness.score}
            </div>
            <div className="xs-card__sub">out of 100</div>
          </div>
        </div>
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <div className="xs-nba">
            <div className="xs-nba__label">{headline.label}</div>
            <div className="xs-nba__title">{headline.title}</div>
          </div>
          {readiness.topActions.length ? (
            <div className="xs-toolbar" style={{ marginTop: 12, flexWrap: 'wrap' }}>
              {readiness.topActions.map((action) => (
                <ActionButton
                  key={action.key}
                  size="sm"
                  icon={<ArrowUpRight size={14} />}
                  disabled={!allowed(action) || (action.target === 'add-photo' && !onAddPhoto)}
                  onClick={() => run(action)}
                >
                  {action.label} to reach {action.reach}
                </ActionButton>
              ))}
            </div>
          ) : null}
          {deniedMessages.length ? (
            <p className="xs-field-hint" style={{ margin: '8px 0 0' }}>
              {deniedMessages.join(' ')} Ask an Admin to take the greyed-out steps.
            </p>
          ) : null}
          <div className="xs-toolbar" style={{ marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <ActionButton
              variant="primary"
              icon={<FileText size={15} />}
              disabled={!readiness.proofPacketReady}
              onClick={() => navigate(`/sale-packets?horse=${horseId}`)}
            >
              Generate proof packet
            </ActionButton>
            <span className="xs-field-hint" style={{ margin: 0 }}>
              {readiness.proofPacketBlocker ??
                `Opens the sale packet builder for this horse with its approved documents selected (${PROOF_PACKET_THRESHOLD}+ and a clear release gate).`}
            </span>
          </div>
        </div>
      </div>

      {detailed ? (
        <div className="xs-mlist" style={{ marginTop: 16 }}>
          {readiness.components.map((component) => (
            <div key={component.key} className="xs-mrow">
              <div className="xs-mrow__main">
                <div className="xs-mrow__title">
                  {component.label}{' '}
                  {component.earned >= component.max ? <StatusChip tone="success">Done</StatusChip> : null}
                </div>
                <div className="xs-mrow__detail">{component.detail}</div>
                <div style={{ marginTop: 6 }}>
                  <ProgressBar
                    value={Math.round((component.earned / component.max) * 100)}
                    tone={component.earned >= component.max ? 'emerald' : 'amber'}
                  />
                </div>
              </div>
              <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {Math.round(component.earned)} / {component.max}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
