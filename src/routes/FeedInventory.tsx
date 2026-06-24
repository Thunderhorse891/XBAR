import { useNavigate } from 'react-router-dom';
import { Plus, Wheat } from 'lucide-react';
import { useUiStore } from '@/store/useUiStore';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { feedInventory } from '@/data/xbarSaasMock';

const usd = (n: number) => `$${n.toLocaleString('en-US')}`;

export default function FeedInventory() {
  const navigate = useNavigate();
  const pushToast = useUiStore((state) => state.pushToast);
  const toast = (m: string) => pushToast({ title: 'Feed & Inventory', message: m, tone: 'success' });

  return (
    <>
      <PageHead
        eyebrow="Care"
        title="Feed & Inventory"
        subtitle="Hay, grain, supplements, medication, bedding, and supplies — with reorder thresholds and operating cost."
        actions={
          <>
            <ActionButton icon={<Wheat size={15} />} onClick={() => toast('Feed logged')}>Log Feed</ActionButton>
            <ActionButton variant="primary" icon={<Plus size={15} />} onClick={() => toast('Inventory item added')}>Add Inventory</ActionButton>
          </>
        }
      />

      <div className="xs-grid-3">
        <Card>
          <div className="xs-card__sub">Feed cost this month</div>
          <div style={{ fontFamily: 'var(--xbar-font-display)', fontSize: 30, fontWeight: 700 }}>{usd(feedInventory.feedCostMonth)}</div>
        </Card>
        <Card>
          <div className="xs-card__sub">Cost per animal-day</div>
          <div style={{ fontFamily: 'var(--xbar-font-display)', fontSize: 30, fontWeight: 700 }}>{usd(feedInventory.costPerAnimalDay)}</div>
        </Card>
        <Card>
          <div className="xs-card__sub">Next reorder</div>
          <div style={{ fontFamily: 'var(--xbar-font-display)', fontSize: 22, fontWeight: 700, marginTop: 4 }}>{feedInventory.nextReorder}</div>
        </Card>
      </div>

      <Card title="Inventory" subtitle="Reorder thresholds and days of supply remaining">
        <div className="xs-mlist">
          {feedInventory.lowStock.map((f) => (
            <div key={f.name} className="xs-mrow">
              <span className="xs-mrow__main">
                <span className="xs-mrow__title">{f.name}</span>
                <span className="xs-mrow__detail">{f.detail}</span>
              </span>
              <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                <StatusChip tone={f.tone}>{f.level}</StatusChip>
                <ActionButton size="sm" onClick={() => toast(`Reorder started: ${f.name}`)}>Reorder</ActionButton>
              </span>
            </div>
          ))}
        </div>
        <ActionButton size="sm" block onClick={() => navigate('/expenses')} >Open operating ledger</ActionButton>
      </Card>
    </>
  );
}
