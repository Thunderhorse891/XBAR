import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Check, FileText, Link2, ShieldCheck, Upload } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { Stepper } from '@/components/saas/flows';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import { buyerFollowUpPath } from '@/lib/buyerRoutes';
import { events, track } from '@/lib/telemetry';
import type { DocumentType } from '@/types/xbar';

const STEPS = ['Select animal', 'Document set', 'Required documents', 'Fix issues', 'Preview', 'Share'];
const PACKET_TYPES = ['Sale documents', 'Buyer review documents', 'Release documents', 'Vet and travel documents', 'Boarding documents'];

const REQUIRED = [
  { id: 'coggins', label: 'Coggins (negative)' },
  { id: 'health', label: 'Health certificate' },
  { id: 'registration', label: 'Registration papers' },
  { id: 'bos', label: 'Bill of sale' },
  { id: 'photos', label: 'Sale photos' },
];

// Map a stored document type onto the required-document slot it satisfies.
const DOC_TYPE_TO_REQ: Partial<Record<DocumentType, string>> = {
  Coggins: 'coggins',
  'Vet Record': 'health',
  Registration: 'registration',
  'Bill of Sale': 'bos',
  'Media Kit': 'photos',
};

export default function SalePacketStudio() {
  const navigate = useNavigate();
  const pushToast = useUiStore((s) => s.pushToast);
  const horses = useXbarStore((s) => s.horses);
  const documents = useXbarStore((s) => s.documents);
  const [step, setStep] = useState(0);
  const [horseId, setHorseId] = useState(() => horses[0]?.id ?? '');
  const [packetType, setPacketType] = useState(PACKET_TYPES[1]);

  const horse = horses.find((h) => h.id === horseId) ?? horses[0];

  // Only count approved (Ready) linked documents — a packet is only "ready to
  // share" when the real proof is persisted and reviewed, matching the packet
  // generator (which includes document.state === 'Ready' only).
  const present = useMemo(() => {
    if (!horse) return [];
    const fromDocs = documents
      .filter((d) => d.horseId === horse.id && d.state === 'Ready')
      .map((d) => DOC_TYPE_TO_REQ[d.type])
      .filter((v): v is string => Boolean(v));
    return Array.from(new Set(fromDocs));
  }, [documents, horse]);

  const missing = REQUIRED.filter((d) => !present.includes(d.id));
  // Blockers reflect the real horse readiness — they clear only when the
  // underlying record is fixed, so the packet can't be faked to "Ready" here.
  const blockers = horse?.readiness?.blockers ?? [];
  const state: 'Ready' | 'Review' | 'Blocked' = blockers.length ? 'Blocked' : missing.length ? 'Review' : 'Ready';
  const tone = state === 'Ready' ? 'success' : state === 'Review' ? 'warning' : 'danger';

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  if (!horse) {
    return (
      <>
        <PageHead eyebrow="Selling / Sale documents" title="Sale documents" subtitle="Choose the horse, check the paperwork, and share only approved records with buyers." />
        <Card>
          <div className="xs-empty">
            <span className="xs-empty__icon"><FileText size={26} /></span>
            <div className="xs-empty__title">No horses to prepare yet</div>
            <div className="xs-empty__sub">Add a horse and its paperwork, then choose the records a buyer can see.</div>
            <ActionButton variant="primary" onClick={() => navigate('/horses?new=1')}>Add first horse</ActionButton>
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHead eyebrow="Selling / Sale documents" title={`${horse.name}`} subtitle="Choose the horse, check the paperwork, and share only approved records with buyers." actions={<StatusChip tone={tone}>{state}</StatusChip>} />

      <Card>
        <Stepper steps={STEPS} current={step} />

        {/* Step 1 — select animal */}
        {step === 0 ? (
          <div className="xs-form" style={{ maxWidth: 520 }}>
            <label>
              <span className="xs-field-label">Animal</span>
              <select className="xs-select" value={horseId} onChange={(e) => setHorseId(e.target.value)}>
                {horses.map((h) => <option key={h.id} value={h.id}>{h.name} — {h.segment}</option>)}
              </select>
            </label>
            <dl className="xs-kv">
              <dt>Segment</dt><dd>{horse.segment}</dd>
              <dt>Ask price</dt><dd>{horse.sale?.askPrice ? `$${horse.sale.askPrice.toLocaleString()}` : '—'}</dd>
              <dt>Current readiness</dt><dd>{horse.readiness?.score ?? 0}%</dd>
            </dl>
          </div>
        ) : null}

        {/* Step 2 - document set */}
        {step === 1 ? (
          <div className="xs-form" style={{ maxWidth: 520 }}>
            <div className="xs-section-label">Choose document set</div>
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
                  <span className="xs-row__main"><span className="xs-row__title">{b}</span><span className="xs-row__meta">Blocks buyer-safe release</span></span>
                  <ActionButton size="sm" variant="primary" icon={<Upload size={14} />} onClick={() => navigate(`/animals/${horse.id}`)}>Fix on profile</ActionButton>
                </div>
              ))}
              {missing.map((m) => (
                <div key={m.id} className="xs-row">
                  <span className="xs-row__main"><span className="xs-row__title">{m.label} missing</span><span className="xs-row__meta">Upload to complete the sale documents</span></span>
                  <ActionButton size="sm" icon={<Upload size={14} />} onClick={() => navigate(`/documents?upload=1&horse=${horse.id}`)}>Upload</ActionButton>
                </div>
              ))}
            </div>
          )
        ) : null}

        {/* Step 5 — preview */}
        {step === 4 ? (
          <div className="xs-grid-2">
            <div>
              <div className="xs-section-label">Ready-to-share preview</div>
              <div className="xs-railcard">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="xs-banner__icon"><FileText size={18} /></span>
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 700 }}>{horse.name} - {packetType}</div><div className="xs-card__sub">Watermarked and seller controls applied</div></div>
                  <StatusChip tone={tone}>{state}</StatusChip>
                </div>
              </div>
            </div>
            <div>
              <div className="xs-section-label">Included</div>
              <div className="xs-mlist">
                {REQUIRED.filter((d) => present.includes(d.id)).map((d) => (
                  <div key={d.id} className="xs-mrow"><span className="xs-mrow__main"><span className="xs-mrow__title">{d.label}</span></span><StatusChip tone="success">Ready to share</StatusChip></div>
                ))}
                {present.length === 0 ? <p className="xs-muted" style={{ fontSize: 13 }}>No documents attached yet.</p> : null}
              </div>
              <div className="xs-railrow"><span className="xs-railrow__label" style={{ display: 'inline-flex', gap: 7, alignItems: 'center' }}><ShieldCheck size={15} /> Ready to share</span><StatusChip tone={state === 'Ready' ? 'success' : 'warning'}>{state === 'Ready' ? 'Verified' : 'Pending'}</StatusChip></div>
            </div>
          </div>
        ) : null}

        {/* Step 6 — share */}
        {step === 5 ? (
          <div style={{ maxWidth: 560 }}>
            <div className="xs-okbanner" style={state === 'Ready' ? undefined : { borderColor: 'rgba(201,130,34,0.35)', background: 'var(--xbar-warning-soft)', color: 'var(--xbar-warning)' }}>
              {state === 'Ready' ? <><Check size={16} /> Sale documents are ready to share.</> : <>Resolve remaining items before sharing with a buyer.</>}
            </div>
            <div className="xs-form" style={{ marginTop: 14 }}>
              <label><span className="xs-field-label">Share link</span><input className="xs-input" readOnly value={`https://xbar.app/packet/${horse.id}`} /></label>
              <div style={{ display: 'flex', gap: 8 }}>
                <ActionButton icon={<Link2 size={15} />} onClick={() => pushToast({ title: 'Copied', message: 'Share link copied', tone: 'success' })}>Copy Link</ActionButton>
                <ActionButton variant="primary" icon={<ArrowRight size={15} />} onClick={() => { track(events.packetShared, { horse: horse.id, packetType }); navigate(buyerFollowUpPath()); }}>Open buyer follow-up</ActionButton>
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
            <ActionButton variant="primary" onClick={() => { track(events.packetShared, { horse: horse.id, packetType }); navigate(buyerFollowUpPath()); }}>Share and open follow-up</ActionButton>
          )}
        </div>
      </Card>
    </>
  );
}
