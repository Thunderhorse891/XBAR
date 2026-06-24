import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, FileText, ShieldCheck } from 'lucide-react';
import { Card, PageHead, StatusChip } from '@/components/saas';
import { saasHorses } from '@/data/xbarSaasMock';

const REQUIRED_DOCS = [
  { id: 'coggins', label: 'Coggins (negative)' },
  { id: 'health', label: 'Health certificate' },
  { id: 'registration', label: 'Registration papers' },
  { id: 'bos', label: 'Bill of sale' },
  { id: 'photos', label: 'Sale photos' },
];

// Which required docs are present per horse (mock).
const presentByHorse: Record<string, string[]> = {
  'rha-pine-barrel-prospect': ['coggins', 'registration', 'bos', 'photos'],
  'thr-copper-canyon': ['coggins', 'health', 'registration', 'bos', 'photos'],
  'thr-juniper-ledge': ['coggins', 'health', 'registration', 'photos'],
  'thr-stone-mesa': ['registration', 'photos'],
};

export default function SalePacketStudio() {
  const navigate = useNavigate();
  const [horseId, setHorseId] = useState(saasHorses[0].id);
  const horse = saasHorses.find((h) => h.id === horseId)!;
  const present = presentByHorse[horseId] ?? [];
  const missing = useMemo(() => REQUIRED_DOCS.filter((d) => !present.includes(d.id)), [present]);

  const packetState: 'Ready' | 'Review' | 'Blocked' =
    horse.blockers.length > 0 ? 'Blocked' : missing.length > 0 ? 'Review' : 'Ready';
  const stateTone = packetState === 'Ready' ? 'success' : packetState === 'Review' ? 'warning' : 'danger';
  const buyerSafe = packetState === 'Ready';

  return (
    <>
      <PageHead
        eyebrow="Transactions"
        title="Sale Packet Studio"
        subtitle="Assemble buyer-ready packets, confirm required documents, and verify Buyer-Safe Proof before release."
        actions={
          <>
            <button type="button" className="xs-btn" onClick={() => navigate('/buyer-deal-room')}>
              Open Deal Room
            </button>
            <button type="button" className="xs-btn xs-btn--primary" disabled={packetState === 'Blocked'} onClick={() => navigate('/buyer-deal-room')}>
              Share Packet
            </button>
          </>
        }
      />

      <div className="xs-grid-2">
        <Card title="Build packet" subtitle="Select a horse and assemble required documents">
          <label className="xs-card__sub" htmlFor="packet-horse" style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>
            Horse
          </label>
          <select
            id="packet-horse"
            value={horseId}
            onChange={(e) => setHorseId(e.target.value)}
            style={{ width: '100%', height: 38, borderRadius: 10, border: '1px solid var(--xbar-border)', padding: '0 12px', background: 'var(--xbar-surface)', fontSize: 13 }}
          >
            {saasHorses.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>

          <div className="xs-card__sub" style={{ fontWeight: 600, margin: '16px 0 8px' }}>Required documents</div>
          <div className="xs-rows">
            {REQUIRED_DOCS.map((d) => {
              const ok = present.includes(d.id);
              return (
                <div key={d.id} className="xs-row">
                  <span className={`xs-check${ok ? ' xs-check--done' : ''}`}>{ok ? <Check size={14} /> : null}</span>
                  <span className="xs-row__main">
                    <span className="xs-row__title">{d.label}</span>
                  </span>
                  <StatusChip tone={ok ? 'success' : 'danger'}>{ok ? 'Attached' : 'Missing'}</StatusChip>
                </div>
              );
            })}
          </div>
        </Card>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Card title="Packet preview" subtitle={horse.name}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <span className="xs-banner__icon">
                <FileText size={18} />
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>{horse.name} — Sale Packet</div>
                <div className="xs-card__sub">{horse.discipline} · Target {`$${horse.targetPrice.toLocaleString()}`}</div>
              </div>
              <StatusChip tone={stateTone}>{packetState}</StatusChip>
            </div>

            <div className="xs-railrow">
              <span className="xs-railrow__label" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <ShieldCheck size={15} /> Buyer-Safe Proof
              </span>
              <StatusChip tone={buyerSafe ? 'success' : 'warning'}>{buyerSafe ? 'Verified' : 'Pending'}</StatusChip>
            </div>
          </Card>

          {packetState !== 'Ready' ? (
            <Card title={packetState === 'Blocked' ? 'Release blocked' : 'Needs review'}>
              <div className="xs-rows">
                {horse.blockers.map((b) => (
                  <div key={b} className="xs-row">
                    <span className="xs-row__main">
                      <span className="xs-row__title">{b}</span>
                      <span className="xs-row__meta">Resolve before this packet can be released.</span>
                    </span>
                    <StatusChip tone="danger">Hold</StatusChip>
                  </div>
                ))}
                {missing.map((m) => (
                  <div key={m.id} className="xs-row">
                    <span className="xs-row__main">
                      <span className="xs-row__title">{m.label} missing</span>
                      <span className="xs-row__meta">Upload to complete the packet.</span>
                    </span>
                    <StatusChip tone="warning">Review</StatusChip>
                  </div>
                ))}
              </div>
              <button type="button" className="xs-btn xs-btn--block" style={{ marginTop: 12 }} onClick={() => navigate('/documents?upload=1')}>
                Upload documents
              </button>
            </Card>
          ) : (
            <Card title="Ready to release">
              <p className="xs-muted" style={{ fontSize: 13, lineHeight: 1.6, margin: '0 0 12px' }}>
                All required documents are attached and Buyer-Safe Proof is verified. This packet can be shared to a buyer deal room.
              </p>
              <button type="button" className="xs-btn xs-btn--brass xs-btn--block" onClick={() => navigate('/buyer-deal-room')}>
                Share to Buyer Deal Room
              </button>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
