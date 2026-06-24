import { useNavigate } from 'react-router-dom';
import { Plus, ShieldCheck, Upload } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { ownershipChain } from '@/data/xbarSaasMock';

export default function OwnershipChain() {
  const navigate = useNavigate();
  const pushToast = useUiStore((s) => s.pushToast);
  const toast = (m: string) => pushToast({ title: 'Ownership Chain', message: m, tone: 'success' });

  return (
    <>
      <PageHead
        eyebrow="Transactions"
        title="Ownership Chain"
        subtitle="Title history and transfer proof for every animal — verified, reviewable, and gap-aware."
        actions={
          <>
            <ActionButton icon={<Upload size={15} />} onClick={() => toast('Proof uploaded')}>Upload Proof</ActionButton>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => toast('Transfer added')}>Add Transfer</ActionButton>
          </>
        }
      />

      <div className="xs-grid-3">
        <Card><div className="xs-card__sub">Chains clear</div><div style={{ fontSize: 28, fontWeight: 700, color: 'var(--xbar-success)' }}>{ownershipChain.filter((o) => o.status === 'Clear').length}</div></Card>
        <Card><div className="xs-card__sub">Need review</div><div style={{ fontSize: 28, fontWeight: 700, color: 'var(--xbar-warning)' }}>{ownershipChain.filter((o) => o.status === 'Review').length}</div></Card>
        <Card><div className="xs-card__sub">Gaps detected</div><div style={{ fontSize: 28, fontWeight: 700, color: 'var(--xbar-danger)' }}>{ownershipChain.filter((o) => o.status === 'Gap Detected').length}</div></Card>
      </div>

      <div className="xs-tablewrap">
        <table className="xs-table">
          <thead><tr><th>Animal</th><th>Current owner</th><th>Proof</th><th>Status</th><th /></tr></thead>
          <tbody>
            {ownershipChain.map((o) => (
              <tr key={o.id} onClick={() => navigate(`/animals/${o.animal === 'RHA Pine Barrel Prospect' ? 'rha-pine-barrel-prospect' : 'thr-copper-canyon'}`)}>
                <td style={{ fontWeight: 600 }}>{o.animal}</td>
                <td>{o.owner}</td>
                <td className="xs-muted">{o.proof}</td>
                <td><StatusChip tone={o.tone}>{o.status}</StatusChip></td>
                <td onClick={(e) => e.stopPropagation()}>{o.status === 'Clear' ? <span className="xs-chip xs-chip--success"><ShieldCheck size={12} /> Verified</span> : <ActionButton size="sm" onClick={() => toast(`${o.animal} proof requested`)}>Resolve</ActionButton>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
