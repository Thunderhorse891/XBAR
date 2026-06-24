import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Eye, MessageSquare } from 'lucide-react';
import { Card, PageHead, SlideOverDrawer, StatusChip } from '@/components/saas';
import { dealRooms, type DealRoom } from '@/data/xbarSaasMock';

const accessTone = { Active: 'success', Pending: 'warning', Revoked: 'danger' } as const;

export default function BuyerDealRoom() {
  const navigate = useNavigate();
  const [rooms, setRooms] = useState(dealRooms);
  const [selected, setSelected] = useState<DealRoom | null>(null);

  function revoke(id: string) {
    setRooms((current) => current.map((r) => (r.id === id ? { ...r, access: 'Revoked' } : r)));
    setSelected(null);
  }
  function markReceived(id: string) {
    setRooms((current) => current.map((r) => (r.id === id ? { ...r, offer: 'Received' } : r)));
    setSelected(null);
  }

  return (
    <>
      <PageHead
        eyebrow="Transactions"
        title="Buyer Deal Room"
        subtitle="Controlled buyer access, packet views, download activity, and offer status across active deals."
        actions={
          <button type="button" className="xs-btn xs-btn--primary" onClick={() => navigate('/sale-packet-studio')}>
            Invite Buyer
          </button>
        }
      />

      <div className="xs-grid-3">
        <Card>
          <div className="xs-card__sub">Active deal rooms</div>
          <div style={{ fontFamily: 'var(--xbar-font-display)', fontSize: 30, fontWeight: 700 }}>{rooms.filter((r) => r.access === 'Active').length}</div>
        </Card>
        <Card>
          <div className="xs-card__sub">Packet views (30d)</div>
          <div style={{ fontFamily: 'var(--xbar-font-display)', fontSize: 30, fontWeight: 700 }}>{rooms.reduce((s, r) => s + r.packetViews, 0)}</div>
        </Card>
        <Card>
          <div className="xs-card__sub">Offers received</div>
          <div style={{ fontFamily: 'var(--xbar-font-display)', fontSize: 30, fontWeight: 700 }}>{rooms.filter((r) => r.offer === 'Received').length}</div>
        </Card>
      </div>

      <Card title="Buyers" subtitle="Click a row to manage access and offers">
        <table className="xs-table">
          <thead>
            <tr>
              <th>Buyer</th>
              <th>Horse</th>
              <th>Access</th>
              <th>Views</th>
              <th>Downloads</th>
              <th>Offer</th>
              <th>Last activity</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((r) => (
              <tr key={r.id} onClick={() => setSelected(r)}>
                <td style={{ fontWeight: 600 }}>{r.buyer}</td>
                <td>{r.horse}</td>
                <td>
                  <StatusChip tone={accessTone[r.access]}>{r.access}</StatusChip>
                </td>
                <td>{r.packetViews}</td>
                <td>{r.downloads}</td>
                <td>{r.offer === 'Received' && r.offerAmount ? `$${r.offerAmount.toLocaleString()}` : r.offer === 'Received' ? 'Received' : '—'}</td>
                <td className="xs-muted">{r.lastActivity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <SlideOverDrawer
        open={Boolean(selected)}
        title={selected?.buyer ?? ''}
        subtitle={selected ? `${selected.horse} · access ${selected.access}` : ''}
        onClose={() => setSelected(null)}
        footer={
          selected ? (
            <>
              <button type="button" className="xs-btn" onClick={() => revoke(selected.id)}>
                Revoke Access
              </button>
              <button type="button" className="xs-btn xs-btn--primary" onClick={() => markReceived(selected.id)}>
                Mark Offer Received
              </button>
            </>
          ) : null
        }
      >
        {selected ? (
          <>
            <div className="xs-grid-2">
              <div className="xs-railcard">
                <div className="xs-railcard__label">Packet views</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 22, fontWeight: 700 }}>
                  <Eye size={18} className="xs-muted" /> {selected.packetViews}
                </div>
              </div>
              <div className="xs-railcard">
                <div className="xs-railcard__label">Downloads</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 22, fontWeight: 700 }}>
                  <Download size={18} className="xs-muted" /> {selected.downloads}
                </div>
              </div>
            </div>

            <div className="xs-railcard">
              <div className="xs-railcard__label">Offer status</div>
              <div className="xs-railrow">
                <span className="xs-railrow__label">Status</span>
                <StatusChip tone={selected.offer === 'Received' ? 'success' : 'neutral'}>{selected.offer === 'Received' ? 'Offer received' : 'No offer yet'}</StatusChip>
              </div>
              {selected.offerAmount ? (
                <div className="xs-railrow">
                  <span className="xs-railrow__label">Amount</span>
                  <span className="xs-railrow__value">${selected.offerAmount.toLocaleString()}</span>
                </div>
              ) : null}
            </div>

            <div className="xs-railcard">
              <div className="xs-railcard__label">Messages & call requests</div>
              <div className="xs-feed">
                <div className="xs-feed__row">
                  <MessageSquare size={15} className="xs-muted" />
                  <span style={{ flex: 1 }}>
                    Call requested
                    <div className="xs-feed__time">1h ago</div>
                  </span>
                </div>
              </div>
            </div>

            <button type="button" className="xs-btn xs-btn--brass xs-btn--block" onClick={() => navigate('/sale-packet-studio')}>
              Prepare Release
            </button>
          </>
        ) : null}
      </SlideOverDrawer>
    </>
  );
}
