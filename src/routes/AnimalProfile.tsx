import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, HeartPulse, Move, Plus, Upload } from 'lucide-react';
import { HorsesIcon } from '@/components/icons';
import { ActionButton, Card, StatusChip } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { useHorseRecord } from '@/store/useXbarStore';
import { formatCurrency } from '@/lib/format';
import type { HorseStatus } from '@/types/xbar';

const TABS = ['Overview', 'Health', 'Documents', 'Ownership', 'Breeding', 'Location', 'Tasks', 'Ready to Sell', 'Buyers', 'Timeline'] as const;

type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
const STATUS_TONE: Record<HorseStatus, Tone> = {
  'In Training': 'info',
  'Broodmare Program': 'neutral',
  'Sale Prep': 'info',
  'Medical Review': 'danger',
  Pasture: 'neutral',
  Retired: 'neutral',
};

export default function AnimalProfile() {
  const navigate = useNavigate();
  const { id } = useParams();
  const pushToast = useUiStore((s) => s.pushToast);
  const [tab, setTab] = useState<string>('Overview');
  const animal = useHorseRecord(id);

  if (!animal) {
    return (
      <>
        <button type="button" className="xs-back" onClick={() => navigate('/animals')}><ArrowLeft size={14} /> Animals</button>
        <Card>
          <div className="xs-empty">
            <span className="xs-empty__icon"><HorsesIcon width={26} height={26} /></span>
            <div className="xs-empty__title">Horse not found</div>
            <div className="xs-empty__sub">This record may have been removed. Go back to your horses to pick another one.</div>
            <ActionButton variant="primary" onClick={() => navigate('/animals')}>Back to horses</ActionButton>
          </div>
        </Card>
      </>
    );
  }

  const toast = (m: string) => pushToast({ title: animal.name, message: m, tone: 'success' });
  const readiness = animal.readiness?.score ?? 0;
  const packetReady = animal.readiness?.packetStatus === 'Ready';
  const location = [animal.location.barn, animal.location.pasture].filter(Boolean).join(' · ') || animal.location.ranch || '—';
  const forSale = animal.sale?.listingState !== 'Hold' && (animal.segment === 'Sale Prospect' || readiness > 0);

  return (
    <>
      <button type="button" className="xs-back" onClick={() => navigate('/animals')}><ArrowLeft size={14} /> Animals</button>

      <div className="xs-objhead">
        <div className="xs-objhead__id">
          <span className="xs-objhead__avatar"><HorsesIcon width={28} height={28} /></span>
          <div>
            <div className="xs-objhead__name">{animal.name}</div>
            <div className="xs-objhead__meta">{animal.breed || 'Horse'} · {animal.sex} · {animal.age} yrs · {location}</div>
            <div className="xs-objhead__chips">
              <StatusChip tone={STATUS_TONE[animal.status] ?? 'neutral'}>{animal.status}</StatusChip>
              {forSale ? <StatusChip tone={packetReady ? 'success' : 'warning'}>{packetReady ? 'Ready to sell' : 'Getting ready'}</StatusChip> : <span className="xs-chip xs-chip--neutral">Not for sale</span>}
            </div>
          </div>
        </div>
        <div className="xs-objhead__actions">
          <ActionButton size="sm" icon={<Move size={14} />} onClick={() => toast('Move drawer opened')}>Move</ActionButton>
          <ActionButton size="sm" icon={<HeartPulse size={14} />} onClick={() => toast('Health record added')}>Add Health</ActionButton>
          <ActionButton size="sm" icon={<Upload size={14} />} onClick={() => navigate('/documents-vault')}>Upload Doc</ActionButton>
          <ActionButton size="sm" variant="primary" icon={<FileText size={14} />} onClick={() => navigate('/sale-packet-studio')}>Build Sale Packet</ActionButton>
        </div>
      </div>

      <div className="xs-tabbar">
        {TABS.map((t) => (
          <button key={t} type="button" className={`xs-tabbar__tab${tab === t ? ' xs-tabbar__tab--active' : ''}`} onClick={() => setTab(t)}>{t}</button>
        ))}
      </div>

      {tab === 'Overview' ? (
        <div className="xs-grid-2">
          <Card title="Identity">
            <dl className="xs-kv">
              <dt>Name</dt><dd>{animal.name}</dd>
              <dt>Breed</dt><dd>{animal.breed || '—'}</dd>
              <dt>Sex</dt><dd>{animal.sex}</dd>
              <dt>Age</dt><dd>{animal.age} yrs</dd>
              <dt>Registry</dt><dd>{animal.registered ? `${animal.registry} · ${animal.registrationNumber || animal.aqhaNumber || '—'}` : 'Unregistered'}</dd>
              <dt>Owner</dt><dd>{animal.owner}{animal.ownerEntity ? ` · ${animal.ownerEntity}` : ''}</dd>
              <dt>Location</dt><dd>{location}</dd>
              <dt>Segment</dt><dd>{animal.segment}</dd>
            </dl>
          </Card>
          <Card title="What to do next">
            <div className="xs-nba"><div className="xs-nba__label">Suggested next step</div><div className="xs-nba__title">{animal.readiness?.blockers?.[0] ?? `Keep ${animal.name}'s records current`}</div></div>
            <div className="xs-toolbar" style={{ marginTop: 12 }}>
              <ActionButton size="sm" onClick={() => navigate('/today')}>Add Task</ActionButton>
              <ActionButton size="sm" variant="primary" onClick={() => navigate('/sale-packet-studio')}>Build sale packet</ActionButton>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === 'Health' ? (
        <Card title="Health &amp; Care" link="Open Health &amp; Care" onLink={() => navigate('/health-care')}>
          {animal.medicalTimeline.length ? (
            <div className="xs-mlist">
              {animal.medicalTimeline.slice(0, 8).map((e) => (
                <div key={e.id} className="xs-mrow">
                  <span className="xs-mrow__main"><span className="xs-mrow__title">{e.title}</span><span className="xs-mrow__detail">{e.summary} · {e.date}</span></span>
                  <StatusChip tone={e.severity === 'high' ? 'danger' : e.severity === 'medium' ? 'warning' : 'success'}>{e.status ?? 'Logged'}</StatusChip>
                </div>
              ))}
            </div>
          ) : (
            <p className="xs-muted" style={{ fontSize: 13, marginTop: 0 }}>No health records yet.{animal.lastVetVisit ? ` Last vet visit ${animal.lastVetVisit}.` : ''}</p>
          )}
          <ActionButton size="sm" icon={<Plus size={14} />} onClick={() => toast('Health record added')}>Add Health Record</ActionButton>
        </Card>
      ) : null}

      {tab === 'Documents' ? (
        <Card title="Paperwork" link="Open paperwork" onLink={() => navigate('/documents-vault')}>
          {animal.documentFacts.length ? (
            <div className="xs-mlist">
              {animal.documentFacts.slice(0, 10).map((f) => (
                <div key={f.id} className="xs-mrow">
                  <span className="xs-mrow__main"><span className="xs-mrow__title">{f.label}</span><span className="xs-mrow__detail">{f.value}</span></span>
                  <StatusChip tone={f.decision === 'Accepted' ? 'success' : f.decision === 'Rejected' ? 'danger' : 'warning'}>{f.decision ?? 'Review'}</StatusChip>
                </div>
              ))}
            </div>
          ) : (
            <p className="xs-muted" style={{ fontSize: 13, marginTop: 0 }}>No paperwork linked to this horse yet.</p>
          )}
        </Card>
      ) : null}

      {tab === 'Ownership' ? (
        <Card title="Ownership" link="Open Ownership" onLink={() => navigate('/ownership-chain')}>
          {animal.ownership.length ? (
            <div className="xs-mlist">
              {animal.ownership.map((o) => (
                <div key={o.id} className="xs-mrow">
                  <span className="xs-mrow__main"><span className="xs-mrow__title">{o.name}</span><span className="xs-mrow__detail">{o.role} · {o.share}%</span></span>
                  <StatusChip tone="success">{o.share}%</StatusChip>
                </div>
              ))}
            </div>
          ) : (
            <p className="xs-muted" style={{ fontSize: 13, marginTop: 0 }}>No ownership stakes recorded.</p>
          )}
        </Card>
      ) : null}

      {tab === 'Breeding' ? (
        <Card title="Breeding & Foaling" link="Open Breeding" onLink={() => navigate('/breeding-foaling')}>
          {animal.breedingTimeline.length ? (
            <div className="xs-mlist">
              {animal.breedingTimeline.slice(0, 8).map((e) => (
                <div key={e.id} className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">{e.title}</span><span className="xs-mrow__detail">{e.summary} · {e.date}</span></span><StatusChip tone="info">{e.status ?? 'Logged'}</StatusChip></div>
              ))}
            </div>
          ) : (
            <p className="xs-muted" style={{ fontSize: 13, marginTop: 0 }}>No active breeding records for this animal.</p>
          )}
          <ActionButton size="sm" icon={<Plus size={14} />} onClick={() => toast('Breeding record added')}>Add Breeding Record</ActionButton>
        </Card>
      ) : null}

      {tab === 'Location' ? (
        <Card title="Location" link="Open Pastures" onLink={() => navigate('/pastures')}>
          <dl className="xs-kv"><dt>Ranch</dt><dd>{animal.location.ranch || '—'}</dd><dt>Barn</dt><dd>{animal.location.barn || '—'}</dd><dt>Pasture</dt><dd>{animal.location.pasture || '—'}</dd><dt>Stall</dt><dd>{animal.location.stall || '—'}</dd></dl>
          <ActionButton size="sm" icon={<Move size={14} />} onClick={() => toast('Move drawer opened')}>Move Animal</ActionButton>
        </Card>
      ) : null}

      {tab === 'Tasks' ? (
        <Card title="Tasks" link="Open Work Queue" onLink={() => navigate('/today')}>
          {animal.alerts.length ? (
            <div className="xs-mlist">
              {animal.alerts.map((a) => (
                <div key={a.id} className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">{a.title}</span><span className="xs-mrow__detail">{a.summary} · {a.module}</span></span><StatusChip tone={a.severity === 'high' ? 'danger' : a.severity === 'medium' ? 'warning' : 'info'}>Open</StatusChip></div>
              ))}
            </div>
          ) : (
            <p className="xs-muted" style={{ fontSize: 13, marginTop: 0 }}>No open tasks for this animal.</p>
          )}
        </Card>
      ) : null}

      {tab === 'Ready to Sell' ? (
        <Card title="Ready to Sell" link="Open sale packet" onLink={() => navigate('/sale-packet-studio')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
            <span className="xs-finbar__track" style={{ flex: 1 }}><span className="xs-finbar__fill" style={{ width: `${readiness}%`, background: readiness >= 95 ? 'var(--xbar-success)' : 'var(--xbar-warning)' }} /></span>
            <strong>{readiness}%</strong>
          </div>
          <div className="xs-mlist">
            <div className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">Packet status</span></span><StatusChip tone={packetReady ? 'success' : 'warning'}>{animal.readiness?.packetStatus ?? 'Review'}</StatusChip></div>
            <div className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">Ready to share with buyers</span></span><StatusChip tone={packetReady ? 'success' : 'warning'}>{packetReady ? 'Verified' : 'Pending'}</StatusChip></div>
            <div className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">Release blockers</span></span><StatusChip tone={animal.readiness?.blockers?.length ? 'danger' : 'success'}>{animal.readiness?.blockers?.length ? `${animal.readiness.blockers.length} blocker${animal.readiness.blockers.length === 1 ? '' : 's'}` : 'Clear'}</StatusChip></div>
          </div>
        </Card>
      ) : null}

      {tab === 'Buyers' ? (
        <Card title="Buyers" link="Open buyer folder" onLink={() => navigate('/buyer-deal-room')}>
          <dl className="xs-kv">
            <dt>Ask price</dt><dd>{animal.sale?.askPrice ? formatCurrency(animal.sale.askPrice) : '—'}</dd>
            <dt>Inquiries</dt><dd>{animal.sale?.inquiryCount ?? 0}</dd>
            <dt>Watchlist</dt><dd>{animal.sale?.watchlistCount ?? 0}</dd>
            <dt>Buyer confidence</dt><dd>{animal.sale?.buyerConfidence ?? 0}%</dd>
          </dl>
        </Card>
      ) : null}

      {tab === 'Timeline' ? (
        <Card title="Timeline">
          {animal.activity.length ? (
            <div className="xs-tl">
              {animal.activity.slice(0, 12).map((e) => (
                <div key={e.id} className="xs-tl__row"><span className="xs-tl__dot" /><span><div className="xs-tl__title">{e.title}</div><div className="xs-tl__time">{e.summary} · {e.date}</div></span></div>
              ))}
            </div>
          ) : (
            <p className="xs-muted" style={{ fontSize: 13, marginTop: 0 }}>No activity recorded yet.</p>
          )}
        </Card>
      ) : null}
    </>
  );
}
