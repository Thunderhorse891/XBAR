import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ShieldCheck, Upload } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { useXbarStore } from '@/store/useXbarStore';
import type { TransferStatus } from '@/types/xbar';

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
const STATUS_TONE: Record<TransferStatus, Tone> = {
  Clear: 'success',
  'Pending Signatures': 'warning',
  'AQHA Review': 'warning',
  'Attention Required': 'danger',
};

export default function OwnershipChain() {
  const navigate = useNavigate();
  const ownershipRecords = useXbarStore((s) => s.ownershipRecords);
  const horses = useXbarStore((s) => s.horses);

  const horseName = useMemo(() => {
    const map = new Map(horses.map((h) => [h.id, h.name]));
    return (id: string) => map.get(id) ?? 'Unlinked animal';
  }, [horses]);

  const counts = useMemo(() => ({
    clear: ownershipRecords.filter((o) => o.transferStatus === 'Clear').length,
    review: ownershipRecords.filter((o) => o.transferStatus === 'Pending Signatures' || o.transferStatus === 'AQHA Review').length,
    gaps: ownershipRecords.filter((o) => o.transferStatus === 'Attention Required').length,
  }), [ownershipRecords]);

  if (ownershipRecords.length === 0) {
    return (
      <>
        <PageHead
          eyebrow="Selling"
          title="Ownership History"
          subtitle="The full ownership history for every horse — who owned it, what's been signed, and what paperwork is still missing."
          actions={<ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>Add Animal</ActionButton>}
        />
        <Card>
          <div className="xs-empty">
            <span className="xs-empty__icon"><ShieldCheck size={26} /></span>
            <div className="xs-empty__title">No ownership records yet</div>
            <div className="xs-empty__sub">Add horses and upload bills of sale, registration papers, and transfer forms — XBAR builds the ownership history and flags anything missing.</div>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>Add first horse</ActionButton>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHead
        eyebrow="Selling"
        title="Ownership History"
        subtitle="The full ownership history for every horse — who owned it, what's been signed, and what paperwork is still missing."
        actions={
          <>
            <ActionButton icon={<Upload size={15} />} onClick={() => navigate('/documents?upload=1')}>Upload Proof</ActionButton>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => navigate('/horses?new=1')}>Add Transfer</ActionButton>
          </>
        }
      />

      <div className="xs-grid-3">
        <Card><div className="xs-card__sub">Chains clear</div><div style={{ fontSize: 28, fontWeight: 700, color: 'var(--xbar-success)' }}>{counts.clear}</div></Card>
        <Card><div className="xs-card__sub">Need review</div><div style={{ fontSize: 28, fontWeight: 700, color: counts.review ? 'var(--xbar-warning)' : 'var(--xbar-text)' }}>{counts.review}</div></Card>
        <Card><div className="xs-card__sub">Gaps detected</div><div style={{ fontSize: 28, fontWeight: 700, color: counts.gaps ? 'var(--xbar-danger)' : 'var(--xbar-text)' }}>{counts.gaps}</div></Card>
      </div>

      <div className="xs-tablewrap">
        <table className="xs-table">
          <thead><tr><th>Animal</th><th>Current owner</th><th>Proof</th><th>Status</th><th /></tr></thead>
          <tbody>
            {ownershipRecords.map((o) => (
              <tr key={o.id} onClick={() => navigate(`/horses/${o.horseId}`)}>
                <td style={{ fontWeight: 600 }}>{horseName(o.horseId)}</td>
                <td>{o.legalOwner}</td>
                <td className="xs-muted">{o.pendingDocuments.length ? `${o.pendingDocuments.length} pending` : `${Math.round(o.confidence * 100)}% verified`}</td>
                <td><StatusChip tone={STATUS_TONE[o.transferStatus]}>{o.transferStatus}</StatusChip></td>
                <td onClick={(e) => e.stopPropagation()}>{o.transferStatus === 'Clear' ? <span className="xs-chip xs-chip--success"><ShieldCheck size={12} /> Verified</span> : <ActionButton size="sm" onClick={() => navigate(`/horses/${o.horseId}`)}>Resolve</ActionButton>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
