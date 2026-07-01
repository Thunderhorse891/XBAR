import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, FileText, Link2, ShieldCheck, Upload } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { Stepper } from '@/components/saas/flows';
import { useUiStore } from '@/store/useUiStore';
import { events, track } from '@/lib/telemetry';
import { resolvedBlockers, saasHorses } from '@/data/xbarSaasMock';

const STEPS = ['Select animal', 'Packet type', 'Required documents', 'Fix issues', 'Preview', 'Share'];
const PACKET_TYPES = ['Sale Prospect Packet', 'Buyer Review Packet', 'Release Packet', 'Vet/Transport Packet', 'Boarding/Client Packet'];

const REQUIRED = [
  { id: 'coggins', label: 'Coggins (negative)' },
  { id: 'health', label: 'Health certificate' },
  { id: 'registration', label: 'Registration papers' },
  { id: 'bos', label: 'Bill of sale' },
  { id: 'photos', label: 'Sale photos' },
];
const presentByHorse: Record<string, string[]> = {
  'rha-pine-barrel-prospect': ['coggins', 'registration', 'bos', 'photos'],
  'thr-copper-canyon': ['coggins', 'health', 'registration', 'bos', 'photos'],
  'thr-juniper-ledge': ['coggins', 'health', 'registration', 'photos'],
  'thr-stone-mesa': ['registration', 'photos'],
};

export default function SalePacketStudio() {
  const navigate = useNavigate();
  const pushToast = useUiStore((s) => s.pushToast);
  const [step, setStep] = useState(0);
  const [horseId, setHorseId] = useState(saasHorses[0].id);
  const [packetType, setPacketType] = useState(PACKET_TYPES[1]);
  // Carry forward any blocker resolved earlier in-session (home Resolve flow).
  const [fixed, setFixed] = useState<string[]>(() => (resolvedBlockers.has(saasHorses[0].id) ? ['health'] : []));

  const horse = saasHorses.find((h) => h.id === horseId)!;
  const present = useMemo(() => [...(presentByHorse[horseId] ?? []), ...fixed], [horseId, fixed]);
  const missing = REQUIRED.filter((d) => !present.includes(d.id));
  const blockers = horse.blockers.filter(() => !fixed.includes('health'));
  const state: 'Ready' | 'Review' | 'Blocked' = blockers.length ? 'Blocked' : missing.length ? 'Review' : 'Ready';
  const tone = state === 'Ready' ? 'success' : state === 'Review' ? 'warning' : 'danger';

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));
  const fix = (id: string) => setFixed((cur) => (cur.includes(id) ? cur : [...cur, id]));

  return (
    <>
      <PageHead eyebrow="Transactions · Sale Packet Builder" title={`${horse.name}`} subtitle="A guided builder that takes one animal from documents to a buyer-ready packet." actions={<StatusChip tone={tone}>{state}</StatusChip>} />

      <Card>
        <Stepper steps={STEPS} current={step} />

        {/* Step 1 — select animal */}
        {step === 0 ? (
          <div className="xs-form" style={{ maxWidth: 520 }}>
            <label>
              <span className="xs-field-label">Animal</span>
              <select className="xs-select" value={horseId} onChange={(e) => { setHorseId(e.target.value); setFixed(resolvedBlockers.has(e.target.value) ? ['health'] : []); }}>
                {saasHorses.map((h) => <option key={h.id} value={h.id}>{h.name} — {h.discipline}</option>)}
              </select>
            </label>
            <dl className="xs-kv">
              <dt>Discipline</dt><dd>{horse.discipline}</dd>
              <dt>Target price</dt><dd>${horse.targetPrice.toLocaleString()}</dd>
              <dt>Current readiness</dt><dd>{horse.readinessScore}%</dd>
            </dl>
          </div>
        ) : null}

        {/* Step 2 — packet type */}
        {step === 1 ? (
          <div className="xs-form" style={{ maxWidth: 520 }}>
            <div className="xs-section-label">Choose packet type</div>
            {PACKET_TYPES.map((t) => (
              <button key={t} type="button" className={`xs-checkitem${packetType === t ? ' xs-checkitem--done' : ''}`} onClick={() => setPacketType(t)} style={{ cursor: 'pointer', textAlign: 'left' }}>
                <span className={`xs-check${packetType === t ? ' xs-check--done' : ''}`}>{packetType === t ? <Check size={14} /> : null}</span>
                <span className="xs-checkitem__body"><span className="xs-checkitem__title">{t}</span></span>
              </button>
            ))}
          </div>
        ) : null}

        {/* Step 3 — required documents */}
        {step === 2 ? (
          <div className="xs-rows">
            {REQUIRED.map((d) => {
              const ok = present.includes(d.id);
              return (
                <div key={d.id} className="xs-row">
                  <span className={`xs-check${ok ? ' xs-check--done' : ''}`}>{ok ? <Check size={14} /> : null}</span>
                  <span className="xs-row__main"><span className="xs-row__title">{d.label}</span></span>
                  <StatusChip tone={ok ? 'success' : 'danger'}>{ok ? 'Attached' : 'Missing'}</StatusChip>
                </div>
              );
            })}
          </div>
        ) : null}

        {/* Step 4 — fix issues */}
        {step === 3 ? (
          state === 'Ready' ? (
            <div className="xs-okbanner"><ShieldCheck size={16} /> No issues. All required documents are attached.</div>
          ) : (
            <div className="xs-rows">
              {blockers.map((b) => (
                <div key={b} className="xs-row">
                  <span className="xs-row__main"><span className="xs-row__title">{b}</span><span className="xs-row__meta">Blocks buyer sharing</span></span>
                  <ActionButton size="sm" variant="primary" icon={<Upload size={14} />} onClick={() => { fix('health'); pushToast({ title: 'Fixed', message: 'Health certificate updated', tone: 'success' }); }}>Fix</ActionButton>
                </div>
              ))}
              {missing.filter((m) => m.id !== 'health').map((m) => (
                <div key={m.id} className="xs-row">
                  <span className="xs-row__main"><span className="xs-row__title">{m.label} missing</span><span className="xs-row__meta">Upload to complete the packet</span></span>
                  <ActionButton size="sm" icon={<Upload size={14} />} onClick={() => { fix(m.id); pushToast({ title: 'Uploaded', message: `${m.label} attached`, tone: 'success' }); }}>Upload</ActionButton>
                </div>
              ))}
            </div>
          )
        ) : null}

        {/* Step 5 — preview */}
        {step === 4 ? (
          <div className="xs-grid-2">
            <div>
              <div className="xs-section-label">Buyer Documents</div>
              <div className="xs-railcard">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="xs-banner__icon"><FileText size={18} /></span>
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 700 }}>{horse.name} — {packetType}</div><div className="xs-card__sub">Watermarked · seller controls applied</div></div>
                  <StatusChip tone={tone}>{state}</StatusChip>
                </div>
              </div>
            </div>
            <div>
              <div className="xs-section-label">Included</div>
              <div className="xs-mlist">
                {REQUIRED.filter((d) => present.includes(d.id)).map((d) => (
                  <div key={d.id} className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">{d.label}</span></span><StatusChip tone="success">Buyer Documents</StatusChip></div>
                ))}
              </div>
              <div className="xs-railrow"><span className="xs-railrow__label" style={{ display: 'inline-flex', gap: 7, alignItems: 'center' }}><ShieldCheck size={15} /> Share With Buyer</span><StatusChip tone={state === 'Ready' ? 'success' : 'warning'}>{state === 'Ready' ? 'Verified' : 'Pending'}</StatusChip></div>
            </div>
          </div>
        ) : null}

        {/* Step 6 — share */}
        {step === 5 ? (
          <div style={{ maxWidth: 560 }}>
            <div className="xs-okbanner" style={state === 'Ready' ? undefined : { borderColor: 'rgba(201,130,34,0.35)', background: 'var(--xbar-warning-soft)', color: 'var(--xbar-warning)' }}>
              {state === 'Ready' ? <><Check size={16} /> Packet is ready to share.</> : <>Resolve remaining items for a ready-to-share packet.</>}
            </div>
            <div className="xs-form" style={{ marginTop: 14 }}>
              <label><span className="xs-field-label">Share link</span><input className="xs-input" readOnly value={`https://xbar.app/packet/${horse.id}`} /></label>
              <div style={{ display: 'flex', gap: 8 }}>
                <ActionButton icon={<Link2 size={15} />} onClick={() => pushToast({ title: 'Copied', message: 'Share link copied', tone: 'success' })}>Copy Link</ActionButton>
                <ActionButton variant="primary" icon={<ArrowRight size={15} />} onClick={() => { track(events.packetShared, { horse: horse.id, packetType }); navigate('/buyer-deal-room'); }}>Open Buyer Folder</ActionButton>
              </div>
            </div>
          </div>
        ) : null}

        {/* wizard controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--xbar-border)' }}>
          <ActionButton icon={<ArrowLeft size={15} />} onClick={back} disabled={step === 0}>Back</ActionButton>
          {step < STEPS.length - 1 ? (
            <ActionButton variant="primary" icon={<ArrowRight size={15} />} onClick={next}>Continue</ActionButton>
          ) : (
            <ActionButton variant="primary" onClick={() => { track(events.packetShared, { horse: horse.id, packetType }); navigate('/buyer-deal-room'); }}>Share & Open Buyer Folder</ActionButton>
          )}
        </div>
      </Card>
    </>
  );
}
