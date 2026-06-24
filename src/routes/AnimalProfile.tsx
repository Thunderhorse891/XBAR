import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, HeartPulse, Move, Plus, Upload } from 'lucide-react';
import { HorsesIcon } from '@/components/icons';
import { ActionButton, Card, StatusChip } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { rosterAnimals } from '@/data/xbarSaasMock';

const TABS = ['Overview', 'Health', 'Documents', 'Ownership', 'Breeding', 'Location', 'Tasks', 'Sale Readiness', 'Buyer Activity', 'Timeline'] as const;

export default function AnimalProfile() {
  const navigate = useNavigate();
  const { id } = useParams();
  const pushToast = useUiStore((s) => s.pushToast);
  const [tab, setTab] = useState<string>('Overview');
  const animal = rosterAnimals.find((a) => a.id === id) ?? rosterAnimals[0];
  const toast = (m: string) => pushToast({ title: animal.name, message: m, tone: 'success' });

  return (
    <>
      <button type="button" className="xs-back" onClick={() => navigate('/animals')}><ArrowLeft size={14} /> Animals</button>

      <div className="xs-objhead">
        <div className="xs-objhead__id">
          <span className="xs-objhead__avatar"><HorsesIcon width={28} height={28} /></span>
          <div>
            <div className="xs-objhead__name">{animal.name}</div>
            <div className="xs-objhead__meta">{animal.species} · {animal.sex} · {animal.age} · {animal.location}</div>
            <div className="xs-objhead__chips">
              <StatusChip tone={animal.tone}>{animal.status}</StatusChip>
              {animal.readiness > 0 ? <StatusChip tone={animal.saleStatus === 'Ready' ? 'success' : animal.saleStatus === 'Review' ? 'warning' : 'danger'}>Sale {animal.saleStatus}</StatusChip> : <span className="xs-chip xs-chip--neutral">Not for sale</span>}
            </div>
          </div>
        </div>
        <div className="xs-objhead__actions">
          <ActionButton size="sm" icon={<Move size={14} />} onClick={() => toast('Move drawer opened')}>Move</ActionButton>
          <ActionButton size="sm" icon={<HeartPulse size={14} />} onClick={() => toast('Health record added')}>Add Health</ActionButton>
          <ActionButton size="sm" icon={<Upload size={14} />} onClick={() => navigate('/documents-vault')}>Upload Doc</ActionButton>
          <ActionButton size="sm" variant="primary" icon={<FileText size={14} />} onClick={() => navigate('/sale-packet-studio')}>Start Sale Packet</ActionButton>
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
              <dt>Species</dt><dd>{animal.species}</dd>
              <dt>Sex</dt><dd>{animal.sex}</dd>
              <dt>Age</dt><dd>{animal.age}</dd>
              <dt>Location</dt><dd>{animal.location}</dd>
              <dt>Group</dt><dd>{animal.group}</dd>
            </dl>
          </Card>
          <Card title="Next required action">
            <div className="xs-nba"><div className="xs-nba__label">Recommended</div><div className="xs-nba__title">{animal.next}</div></div>
            <div className="xs-toolbar" style={{ marginTop: 12 }}>
              <ActionButton size="sm" onClick={() => navigate('/today')}>Add Task</ActionButton>
              <ActionButton size="sm" variant="primary" onClick={() => navigate('/sale-packet-studio')}>Open Sale Packet</ActionButton>
            </div>
          </Card>
        </div>
      ) : null}

      {tab === 'Health' ? (
        <Card title="Health & Compliance" link="Open Health & Care" onLink={() => navigate('/health-care')}>
          <div className="xs-mlist">
            <div className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">Coggins</span><span className="xs-mrow__detail">Negative · current</span></span><StatusChip tone="success">OK</StatusChip></div>
            <div className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">Health certificate</span><span className="xs-mrow__detail">Expiration date missing</span></span><StatusChip tone="danger">Blocker</StatusChip></div>
            <div className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">Vaccines</span><span className="xs-mrow__detail">Spring booster due</span></span><StatusChip tone="warning">Due</StatusChip></div>
            <div className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">Farrier</span><span className="xs-mrow__detail">Trim cycle</span></span><StatusChip tone="warning">Due</StatusChip></div>
          </div>
          <ActionButton size="sm" icon={<Plus size={14} />} onClick={() => toast('Health record added')}>Add Health Record</ActionButton>
        </Card>
      ) : null}

      {tab === 'Documents' ? (
        <Card title="Documents" link="Open Vault" onLink={() => navigate('/documents-vault')}>
          <div className="xs-mlist">
            <div className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">Registration papers</span><span className="xs-mrow__detail">On file · buyer-safe</span></span><StatusChip tone="success">Ready</StatusChip></div>
            <div className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">Coggins (negative)</span><span className="xs-mrow__detail">Expires 2026-11-02</span></span><StatusChip tone="success">Current</StatusChip></div>
            <div className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">Health certificate</span><span className="xs-mrow__detail">Expiration date missing</span></span><StatusChip tone="danger">Missing</StatusChip></div>
          </div>
        </Card>
      ) : null}

      {tab === 'Ownership' ? (
        <Card title="Ownership chain" link="Open Ownership" onLink={() => navigate('/ownership-chain')}>
          <div className="xs-tl">
            <div className="xs-tl__row"><span className="xs-tl__dot" /><span><div className="xs-tl__title">Thunder Horse Ranch — current owner</div><div className="xs-tl__time">Acquired 2023 · bill of sale on file</div></span></div>
            <div className="xs-tl__row"><span className="xs-tl__dot" /><span><div className="xs-tl__title">Prior: Rocking H Ranch</div><div className="xs-tl__time">Transfer verified</div></span></div>
          </div>
          <StatusChip tone="success">Chain clear</StatusChip>
        </Card>
      ) : null}

      {tab === 'Breeding' ? (
        <Card title="Breeding & Foaling" link="Open Breeding" onLink={() => navigate('/breeding-foaling')}>
          <p className="xs-muted" style={{ fontSize: 13, marginTop: 0 }}>No active breeding records for this animal.</p>
          <ActionButton size="sm" icon={<Plus size={14} />} onClick={() => toast('Breeding record added')}>Add Breeding Record</ActionButton>
        </Card>
      ) : null}

      {tab === 'Location' ? (
        <Card title="Location" link="Open Pastures" onLink={() => navigate('/pastures')}>
          <dl className="xs-kv"><dt>Current</dt><dd>{animal.location}</dd><dt>Last move</dt><dd>4h ago · from Main Barn</dd><dt>Water</dt><dd>OK</dd><dt>Fence</dt><dd>OK</dd></dl>
          <ActionButton size="sm" icon={<Move size={14} />} onClick={() => toast('Move drawer opened')}>Move Animal</ActionButton>
        </Card>
      ) : null}

      {tab === 'Tasks' ? (
        <Card title="Tasks" link="Open Work Queue" onLink={() => navigate('/today')}>
          <div className="xs-mlist"><div className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">{animal.next}</span><span className="xs-mrow__detail">Due today · Erin W.</span></span><StatusChip tone="warning">Open</StatusChip></div></div>
        </Card>
      ) : null}

      {tab === 'Sale Readiness' ? (
        <Card title="Sale Readiness" link="Open Studio" onLink={() => navigate('/sale-packet-studio')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
            <span className="xs-finbar__track" style={{ flex: 1 }}><span className="xs-finbar__fill" style={{ width: `${animal.readiness}%`, background: animal.readiness >= 95 ? 'var(--xbar-success)' : 'var(--xbar-warning)' }} /></span>
            <strong>{animal.readiness}%</strong>
          </div>
          <div className="xs-mlist">
            <div className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">Documents</span></span><StatusChip tone="warning">Review</StatusChip></div>
            <div className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">Buyer-safe proof</span></span><StatusChip tone="warning">Pending</StatusChip></div>
            <div className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">Release blockers</span></span><StatusChip tone="danger">1 blocker</StatusChip></div>
          </div>
        </Card>
      ) : null}

      {tab === 'Buyer Activity' ? (
        <Card title="Buyer Activity" link="Open Deal Room" onLink={() => navigate('/buyer-deal-room')}>
          <dl className="xs-kv"><dt>Packet views</dt><dd>8</dd><dt>Downloads</dt><dd>2</dd><dt>Active buyers</dt><dd>2</dd><dt>Top offer</dt><dd>$20,000</dd></dl>
        </Card>
      ) : null}

      {tab === 'Timeline' ? (
        <Card title="Timeline">
          <div className="xs-tl">
            <div className="xs-tl__row"><span className="xs-tl__dot" /><span><div className="xs-tl__title">Buyer downloaded packet</div><div className="xs-tl__time">12m ago</div></span></div>
            <div className="xs-tl__row"><span className="xs-tl__dot" /><span><div className="xs-tl__title">Moved to {animal.location}</div><div className="xs-tl__time">4h ago</div></span></div>
            <div className="xs-tl__row"><span className="xs-tl__dot" /><span><div className="xs-tl__title">Offer recorded — $20,000</div><div className="xs-tl__time">Yesterday</div></span></div>
            <div className="xs-tl__row"><span className="xs-tl__dot" /><span><div className="xs-tl__title">Coggins uploaded</div><div className="xs-tl__time">3 days ago</div></span></div>
          </div>
        </Card>
      ) : null}
    </>
  );
}
