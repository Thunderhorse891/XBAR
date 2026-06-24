import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, Download, Eye, MessageSquare, Phone, Send, ShieldCheck } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { dealRooms, type DealRoom } from '@/data/xbarSaasMock';

const accessTone = { Active: 'success', Pending: 'warning', Revoked: 'danger' } as const;
const initials = (s: string) => s.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export default function BuyerDealRoom() {
  const navigate = useNavigate();
  const pushToast = useUiStore((s) => s.pushToast);
  const [rooms, setRooms] = useState(dealRooms);
  const [selectedId, setSelectedId] = useState(dealRooms[0].id);
  const selected = rooms.find((r) => r.id === selectedId) ?? rooms[0];
  const toast = (m: string) => pushToast({ title: 'Buyer Deal Room', message: m, tone: 'success' });

  const update = (id: string, patch: Partial<DealRoom>) => setRooms((cur) => cur.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <>
      <PageHead
        eyebrow="Transactions"
        title="Buyer Deal Room"
        subtitle="A controlled transaction room — buyer access, packet activity, offers, and release."
        actions={<ActionButton variant="primary" icon={<Send size={15} />} onClick={() => toast('Buyer invitation drafted')}>Invite Buyer</ActionButton>}
      />

      <div className="xs-md">
        {/* master list */}
        <div className="xs-md__list">
          <div className="xs-md__listhead"><span>Buyers</span><span>{rooms.length}</span></div>
          {rooms.map((r) => (
            <button key={r.id} type="button" className={`xs-mdrow${r.id === selectedId ? ' xs-mdrow--active' : ''}`} onClick={() => setSelectedId(r.id)}>
              <span className="xs-mdrow__avatar">{initials(r.buyer)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="xs-mdrow__name">{r.buyer}</span>
                <span className="xs-mdrow__meta">{r.horse} · {r.lastActivity}</span>
              </span>
              <StatusChip tone={accessTone[r.access]}>{r.access}</StatusChip>
            </button>
          ))}
        </div>

        {/* detail pane */}
        <div className="xs-md__detail">
          <div className="xs-detailhead">
            <div>
              <div className="xs-detailhead__name">{selected.buyer}</div>
              <div className="xs-detailhead__meta">Interested in {selected.horse} · last active {selected.lastActivity}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <StatusChip tone={accessTone[selected.access]}>Access {selected.access}</StatusChip>
                {selected.offer === 'Received' ? <StatusChip tone="success">Offer received</StatusChip> : <StatusChip tone="neutral">No offer yet</StatusChip>}
              </div>
            </div>
            <div className="xs-toolbar">
              <ActionButton size="sm" icon={<Ban size={14} />} onClick={() => { update(selected.id, { access: 'Revoked' }); toast('Access revoked'); }}>Revoke</ActionButton>
              <ActionButton size="sm" variant="primary" icon={<ShieldCheck size={14} />} onClick={() => navigate('/sale-packet-studio')}>Prepare Release</ActionButton>
            </div>
          </div>

          <div className="xs-grid-3">
            <Card><div className="xs-card__sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Eye size={14} /> Packet views</div><div style={{ fontSize: 26, fontWeight: 700 }}>{selected.packetViews}</div></Card>
            <Card><div className="xs-card__sub" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Download size={14} /> Downloads</div><div style={{ fontSize: 26, fontWeight: 700 }}>{selected.downloads}</div></Card>
            <Card><div className="xs-card__sub">Packet access</div><div style={{ marginTop: 6 }}><StatusChip tone={accessTone[selected.access]}>{selected.access}</StatusChip></div></Card>
          </div>

          <Card title="Offer">
            {selected.offer === 'Received' && selected.offerAmount ? (
              <dl className="xs-kv">
                <dt>Status</dt><dd><StatusChip tone="success">Offer received</StatusChip></dd>
                <dt>Amount</dt><dd style={{ fontWeight: 700 }}>${selected.offerAmount.toLocaleString()}</dd>
                <dt>vs target</dt><dd>{selected.offerAmount >= 30000 ? 'At/near target' : 'Below target'}</dd>
              </dl>
            ) : (
              <>
                <p className="xs-muted" style={{ fontSize: 13, margin: '0 0 12px' }}>No offer recorded yet for this buyer.</p>
                <ActionButton size="sm" variant="primary" onClick={() => { update(selected.id, { offer: 'Received', offerAmount: 22000 }); toast('Offer recorded'); }}>Record Offer</ActionButton>
              </>
            )}
          </Card>

          <Card title="Messages & call requests">
            <div className="xs-tl">
              <div className="xs-tl__row"><span className="xs-tl__dot" /><span><div className="xs-tl__title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Phone size={13} /> Call requested</div><div className="xs-tl__time">1h ago</div></span></div>
              <div className="xs-tl__row"><span className="xs-tl__dot" /><span><div className="xs-tl__title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><MessageSquare size={13} /> "Can you confirm the Coggins date?"</div><div className="xs-tl__time">3h ago</div></span></div>
            </div>
            <div className="xs-toolbar" style={{ marginTop: 12 }}>
              <ActionButton size="sm" icon={<MessageSquare size={14} />} onClick={() => toast('Reply sent')}>Reply</ActionButton>
              <ActionButton size="sm" icon={<Phone size={14} />} onClick={() => toast('Call scheduled')}>Schedule Call</ActionButton>
              <ActionButton size="sm" icon={<Send size={14} />} onClick={() => navigate('/sale-packet-studio')}>Share Packet</ActionButton>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
