import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ban, MessageSquare, Phone, Send, ShieldCheck, Users } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import { events, track } from '@/lib/telemetry';
import type { SalesLead } from '@/types/xbar';

type Access = 'Active' | 'Pending' | 'Revoked';
const accessTone = { Active: 'success', Pending: 'warning', Revoked: 'danger' } as const;
const initials = (s: string) => s.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export default function BuyerDealRoom() {
  const navigate = useNavigate();
  const pushToast = useUiStore((s) => s.pushToast);
  const leads = useXbarStore((s) => s.salesLeads);
  const horses = useXbarStore((s) => s.horses);
  const [selectedId, setSelectedId] = useState<string>(() => leads[0]?.id ?? '');
  const [revoked, setRevoked] = useState<Set<string>>(new Set());
  const [recorded, setRecorded] = useState<Record<string, number>>({});
  const toast = (m: string) => pushToast({ title: 'Buyer Deal Room', message: m, tone: 'success' });

  const horseName = useMemo(() => {
    const map = new Map(horses.map((h) => [h.id, h.name]));
    return (l: SalesLead) => map.get(l.horseId) ?? 'Unlinked animal';
  }, [horses]);

  const accessOf = (l: SalesLead): Access => (revoked.has(l.id) ? 'Revoked' : l.shareReady ? 'Active' : 'Pending');
  const offerOf = (l: SalesLead) => recorded[l.id] ?? l.offerAmount;

  const selected = leads.find((r) => r.id === selectedId) ?? leads[0];

  if (!selected) {
    return (
      <>
        <PageHead
          eyebrow="Selling"
          title="Buyer Folder"
          subtitle="One folder per buyer — what you've shared, their offer, and follow-ups, all in one place."
          actions={<ActionButton variant="primary" icon={<Send size={15} />} onClick={() => navigate('/sale-packet-studio')}>Start a packet</ActionButton>}
        />
        <Card>
          <div className="xs-empty">
            <span className="xs-empty__icon"><Users size={26} /></span>
            <div className="xs-empty__title">No buyers yet</div>
            <div className="xs-empty__sub">Build a sale packet and share it to open a folder for each buyer — you'll keep what you shared, their offer, and follow-ups all in one place.</div>
            <ActionButton variant="primary" onClick={() => navigate('/sale-packet-studio')}>Build a sale packet</ActionButton>
          </div>
        </Card>
      </>
    );
  }

  const selAccess = accessOf(selected);
  const selOffer = offerOf(selected);

  return (
    <>
      <PageHead
        eyebrow="Selling"
        title="Buyer Folder"
        subtitle="One folder per buyer — what you've shared, their offer, and follow-ups, all in one place."
        actions={<ActionButton variant="primary" icon={<Send size={15} />} onClick={() => toast('Buyer invitation drafted')}>Invite Buyer</ActionButton>}
      />

      <div className="xs-md">
        {/* master list */}
        <div className="xs-md__list">
          <div className="xs-md__listhead"><span>Buyers</span><span>{leads.length}</span></div>
          {leads.map((r) => (
            <button key={r.id} type="button" className={`xs-mdrow${r.id === selected.id ? ' xs-mdrow--active' : ''}`} onClick={() => { track(events.buyerSelected, { id: r.id }); setSelectedId(r.id); }}>
              <span className="xs-mdrow__avatar">{initials(r.name)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="xs-mdrow__name">{r.name}</span>
                <span className="xs-mdrow__meta">{horseName(r)} · {r.lastTouch}</span>
              </span>
              <StatusChip tone={accessTone[accessOf(r)]}>{accessOf(r)}</StatusChip>
            </button>
          ))}
        </div>

        {/* detail pane */}
        <div className="xs-md__detail">
          <div className="xs-detailhead">
            <div>
              <div className="xs-detailhead__name">{selected.name}</div>
              <div className="xs-detailhead__meta">Interested in {horseName(selected)} · last active {selected.lastTouch}</div>
              <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                <StatusChip tone={accessTone[selAccess]}>Access {selAccess}</StatusChip>
                {selOffer ? <StatusChip tone="success">Offer received</StatusChip> : <StatusChip tone="neutral">No offer yet</StatusChip>}
              </div>
            </div>
            <div className="xs-toolbar">
              <ActionButton size="sm" icon={<Ban size={14} />} onClick={() => { track(events.buyerAccessRevoked, { id: selected.id }); setRevoked((cur) => new Set(cur).add(selected.id)); toast('Access revoked'); }}>Revoke</ActionButton>
              <ActionButton size="sm" variant="primary" icon={<ShieldCheck size={14} />} onClick={() => navigate('/sale-packet-studio')}>Prepare Release</ActionButton>
            </div>
          </div>

          <div className="xs-grid-3">
            <Card><div className="xs-card__sub">Stage</div><div style={{ marginTop: 6 }}><StatusChip tone={selected.stage === 'Closed' ? 'success' : selected.stage === 'Offer' ? 'warning' : 'info'}>{selected.stage}</StatusChip></div></Card>
            <Card><div className="xs-card__sub">Channel</div><div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{selected.channel}</div></Card>
            <Card><div className="xs-card__sub">Packet access</div><div style={{ marginTop: 6 }}><StatusChip tone={accessTone[selAccess]}>{selAccess}</StatusChip></div></Card>
          </div>

          <Card title="Offer">
            {selOffer ? (
              <dl className="xs-kv">
                <dt>Status</dt><dd><StatusChip tone="success">{selected.offerStatus ?? 'Offer received'}</StatusChip></dd>
                <dt>Amount</dt><dd style={{ fontWeight: 700 }}>${selOffer.toLocaleString()}</dd>
                {selected.counterOfferAmount ? <><dt>Counter</dt><dd>${selected.counterOfferAmount.toLocaleString()}</dd></> : null}
              </dl>
            ) : (
              <>
                <p className="xs-muted" style={{ fontSize: 13, margin: '0 0 12px' }}>No offer recorded yet for this buyer.</p>
                <ActionButton size="sm" variant="primary" onClick={() => { track(events.buyerOfferRecorded, { id: selected.id, amount: 22000 }); setRecorded((cur) => ({ ...cur, [selected.id]: 22000 })); toast('Offer recorded'); }}>Record Offer</ActionButton>
              </>
            )}
          </Card>

          <Card title="Follow-up & notes">
            <dl className="xs-kv">
              <dt>Next follow-up</dt><dd>{selected.nextFollowUp ?? 'Not scheduled'}</dd>
              <dt>Notes</dt><dd>{selected.notes ?? '—'}</dd>
            </dl>
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
