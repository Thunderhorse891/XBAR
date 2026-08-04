import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Camera, Copy, FileText, HeartPulse, Move, Pencil, Plus, Upload } from 'lucide-react';
import { HorsesIcon } from '@/components/icons';
import { ActionButton, Card, StatusChip } from '@/components/saas';
import { useUiStore } from '@/store/useUiStore';
import { useHorseRecord, useXbarStore } from '@/store/useXbarStore';
import { formatCurrency, formatPercent } from '@/lib/format';
import { billingPath } from '@/lib/billingRoutes';
import { buyerFollowUpPath } from '@/lib/buyerRoutes';
import { hasRoleCapability } from '@/lib/permissions';
import { animalPassportId, identityCompleteness } from '@/lib/animalPassport';
import { type AnimalFinancialStatus, buildRanchFinancials } from '@/lib/profitIntelligence';
import { profitIntelligenceGate } from '@/lib/subscriptionGates';
import type { ChipTone } from '@/types/saas';
import type { HorseStatus } from '@/types/xbar';

// Stagger index for the motion system; the CSS var drives each child's delay.
const motionIndex = (index: number): CSSProperties => ({ ['--motion-index' as string]: index }) as CSSProperties;

// How each sale state reads on the per-animal money panel.
const MONEY_STATUS: Record<AnimalFinancialStatus, { chip: ChipTone; label: string; valueLabel: string }> = {
  sold: { chip: 'success', label: 'Sold', valueLabel: 'Sold for' },
  pipeline: { chip: 'info', label: 'In play', valueLabel: 'Best offer' },
  held: { chip: 'neutral', label: 'Held', valueLabel: 'Asking price' },
};

const TABS = [
  'Overview',
  'Health',
  'Documents',
  'Ownership',
  'Breeding',
  'Location',
  'Tasks',
  'Ready to Sell',
  'Buyers',
  'Timeline',
] as const;

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
  const openQuickCreate = useUiStore((s) => s.openQuickCreate);
  const pushToast = useUiStore((s) => s.pushToast);
  const uploadHorseMedia = useXbarStore((s) => s.uploadHorseMedia);
  const currentRole = useXbarStore((s) => s.currentRole);
  const expenseReceipts = useXbarStore((s) => s.expenseReceipts);
  const salesLeads = useXbarStore((s) => s.salesLeads);
  const subscription = useXbarStore((s) => s.subscription);
  // Profit intelligence (projected profit, margin, safe-price) is a Ranch Ops
  // feature; the per-animal money panel below respects the same gate as the Money
  // view so it never leaks a paid entitlement.
  const profitGate = profitIntelligenceGate(subscription);
  const [tab, setTab] = useState<string>('Overview');
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const animal = useHorseRecord(id);

  // This animal's honest money picture, straight from the shared engine (same
  // rules as the Dashboard money band and the Money view), so profit is only ever
  // shown when both its price and cost are known.
  const money = useMemo(
    () => (animal ? (buildRanchFinancials([animal], expenseReceipts, salesLeads).perAnimal[0] ?? null) : null),
    [animal, expenseReceipts, salesLeads],
  );

  const passportId = animalPassportId(animal?.id);
  const canUploadMedia = hasRoleCapability(currentRole, 'uploadMedia');

  async function onPhotoSelected(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const files = input.files ? Array.from(input.files) : [];
    input.value = ''; // allow re-selecting the same file after an error
    if (!animal || !files.length) return;
    setUploadingPhoto(true);
    try {
      // This is a horse-photo capture control (camera / image picker), so tag the
      // asset with a real horse-photo kind rather than guessing from the filename
      // — otherwise a file named e.g. "pedigree.jpg" would be classed as a
      // document, yet still get promoted to the primary image. Both entry points
      // set the primary: add the hero when none exists, replace it otherwise;
      // extra files join the gallery.
      const result = await uploadHorseMedia({
        horseId: animal.id,
        files,
        kind: 'Conformation',
        makePrimary: true,
      });
      pushToast({
        title: result.ok ? 'Photo added' : 'Upload failed',
        message: result.message,
        tone: result.ok ? 'success' : 'error',
      });
    } catch {
      pushToast({ title: 'Upload failed', message: 'The photo could not be uploaded. Try again.', tone: 'error' });
    } finally {
      setUploadingPhoto(false);
    }
  }
  async function copyPassportId() {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(passportId);
      pushToast({ title: 'Copied', message: `XBAR ID ${passportId} copied to clipboard.`, tone: 'success' });
    } catch {
      pushToast({
        title: 'Copy failed',
        message: `Your browser blocked copying. XBAR ID: ${passportId}`,
        tone: 'error',
      });
    }
  }

  if (!animal) {
    return (
      <>
        <button type="button" className="xs-back" onClick={() => navigate('/horses')}>
          <ArrowLeft size={14} /> Horses
        </button>
        <Card>
          <div className="xs-empty">
            <span className="xs-empty__icon">
              <HorsesIcon width={26} height={26} />
            </span>
            <div className="xs-empty__title">Horse not found</div>
            <div className="xs-empty__sub">
              This record may have been removed. Go back to your horses to pick another one.
            </div>
            <ActionButton variant="primary" onClick={() => navigate('/horses')}>
              Back to horses
            </ActionButton>
          </div>
        </Card>
      </>
    );
  }

  const readiness = animal.readiness?.score ?? 0;
  const packetReady = animal.readiness?.packetStatus === 'Ready';
  const identity = identityCompleteness(animal);
  const identityTone: Tone = identity.percent >= 90 ? 'success' : identity.percent >= 60 ? 'info' : 'warning';
  // Every identity gap except a Photo is filled from the Edit Horse drawer; a
  // Photo is added through the camera-capture control on the avatar. So the
  // "Complete passport" (drawer) CTA only lists gaps the drawer can resolve —
  // the Photo gap is handled by its own Add Photo control instead of dead-ending.
  const drawerFixableMissing = identity.missing.filter((label) => label !== 'Photo');
  const photoUrl =
    animal.profileImage ||
    animal.gallery?.find(
      (asset) => asset.url && (asset.kind === 'Hero' || asset.kind === 'Conformation' || asset.kind === 'Sale Still'),
    )?.url ||
    '';
  const location =
    [animal.location.barn, animal.location.pasture].filter(Boolean).join(' · ') || animal.location.ranch || '—';
  const forSale = animal.sale?.listingState !== 'Hold' && (animal.segment === 'Sale Prospect' || readiness > 0);

  return (
    <>
      <button type="button" className="xs-back" onClick={() => navigate('/horses')}>
        <ArrowLeft size={14} /> Horses
      </button>

      <div className="xs-objhead">
        <div className="xs-objhead__id">
          {canUploadMedia ? (
            <button
              type="button"
              className="xs-objhead__avatar xs-objhead__avatar--action"
              onClick={() => photoInputRef.current?.click()}
              disabled={uploadingPhoto}
              title={photoUrl ? 'Replace photo' : 'Add a photo'}
              aria-label={photoUrl ? 'Replace horse photo' : 'Add horse photo'}
            >
              {photoUrl ? (
                <img className="xs-objhead__avatar-img" src={photoUrl} alt={animal.name} />
              ) : (
                <HorsesIcon width={28} height={28} />
              )}
              <span className="xs-objhead__avatar-cam" aria-hidden="true">
                <Camera size={13} />
              </span>
            </button>
          ) : (
            <span className="xs-objhead__avatar">
              {photoUrl ? (
                <img className="xs-objhead__avatar-img" src={photoUrl} alt={animal.name} />
              ) : (
                <HorsesIcon width={28} height={28} />
              )}
            </span>
          )}
          <input
            ref={photoInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            hidden
            onChange={onPhotoSelected}
          />
          <div>
            <div className="xs-objhead__name">{animal.name}</div>
            <div className="xs-objhead__meta">
              {animal.breed || 'Horse'} · {animal.sex} · {animal.age} yrs · {location}
            </div>
            <button
              type="button"
              className="xs-passport-id"
              onClick={copyPassportId}
              title="Copy this animal's permanent XBAR ID"
            >
              <span className="xs-passport-id__label">XBAR ID</span>
              <code className="xs-passport-id__code">{passportId}</code>
              <Copy size={12} aria-hidden="true" />
            </button>
            <div className="xs-objhead__chips">
              <StatusChip tone={STATUS_TONE[animal.status] ?? 'neutral'}>{animal.status}</StatusChip>
              {forSale ? (
                <StatusChip tone={packetReady ? 'success' : 'warning'}>
                  {packetReady ? 'Ready to sell' : 'Getting ready'}
                </StatusChip>
              ) : (
                <span className="xs-chip xs-chip--neutral">Not for sale</span>
              )}
              <StatusChip tone={identityTone}>Passport {identity.percent}%</StatusChip>
            </div>
          </div>
        </div>
        <div className="xs-objhead__actions">
          <ActionButton
            size="sm"
            icon={<Pencil size={14} />}
            onClick={() => openQuickCreate({ action: 'Edit Horse', horseId: animal.id })}
          >
            Edit details
          </ActionButton>
          <ActionButton
            size="sm"
            icon={<Move size={14} />}
            onClick={() => openQuickCreate({ action: 'Move Horse', horseId: animal.id })}
          >
            Move
          </ActionButton>
          <ActionButton
            size="sm"
            icon={<HeartPulse size={14} />}
            onClick={() => openQuickCreate({ action: 'Add Health Record', horseId: animal.id })}
          >
            Add Health
          </ActionButton>
          <ActionButton size="sm" icon={<Upload size={14} />} onClick={() => navigate('/documents')}>
            Upload Doc
          </ActionButton>
          {canUploadMedia && !photoUrl ? (
            <ActionButton
              size="sm"
              icon={<Camera size={14} />}
              onClick={() => photoInputRef.current?.click()}
              disabled={uploadingPhoto}
            >
              {uploadingPhoto ? 'Uploading…' : 'Add Photo'}
            </ActionButton>
          ) : null}
          <ActionButton
            size="sm"
            variant="primary"
            icon={<FileText size={14} />}
            onClick={() => navigate('/sale-packets')}
          >
            Build Sale Packet
          </ActionButton>
        </div>
      </div>

      <div className="xs-tabbar">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            className={`xs-tabbar__tab${tab === t ? ' xs-tabbar__tab--active' : ''}`}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' ? (
        <>
          <div className="xs-grid-2">
            <Card title="Identity">
              <dl className="xs-kv">
                <dt>Name</dt>
                <dd>{animal.name}</dd>
                <dt>Breed</dt>
                <dd>{animal.breed || '—'}</dd>
                <dt>Sex</dt>
                <dd>{animal.sex}</dd>
                {animal.color ? (
                  <>
                    <dt>Color</dt>
                    <dd>{animal.color}</dd>
                  </>
                ) : null}
                <dt>Age</dt>
                <dd>{animal.age ? `${animal.age} yrs` : animal.foaledOn ? `Foaled ${animal.foaledOn}` : '—'}</dd>
                <dt>Registry</dt>
                <dd>
                  {animal.registered
                    ? `${animal.registry} · ${animal.registrationNumber || animal.aqhaNumber || '—'}`
                    : 'Unregistered'}
                </dd>
                {animal.bloodline?.sire ? (
                  <>
                    <dt>Sire</dt>
                    <dd>{animal.bloodline.sire}</dd>
                  </>
                ) : null}
                {animal.bloodline?.dam ? (
                  <>
                    <dt>Dam</dt>
                    <dd>{animal.bloodline.dam}</dd>
                  </>
                ) : null}
                <dt>Owner</dt>
                <dd>
                  {animal.owner}
                  {animal.ownerEntity ? ` · ${animal.ownerEntity}` : ''}
                </dd>
                <dt>Location</dt>
                <dd>{location}</dd>
                <dt>Segment</dt>
                <dd>{animal.segment}</dd>
              </dl>
            </Card>
            <Card title="What to do next">
              <div className="xs-nba">
                <div className="xs-nba__label">Suggested next step</div>
                <div className="xs-nba__title">
                  {animal.readiness?.blockers?.[0] ?? `Keep ${animal.name}'s records current`}
                </div>
              </div>
              {identity.missing.length ? (
                <div className="xs-passport-gap">
                  <div className="xs-passport-gap__head">
                    <span>
                      Passport {identity.present}/{identity.total} complete
                    </span>
                    <StatusChip tone={identityTone}>{identity.percent}%</StatusChip>
                  </div>
                  <p className="xs-muted" style={{ fontSize: 12.5, margin: '4px 0 0' }}>
                    Add to complete the buyer-ready passport: {identity.missing.join(', ')}.
                  </p>
                </div>
              ) : (
                <p className="xs-muted" style={{ fontSize: 12.5, marginTop: 10 }}>
                  Passport identity is complete — every core field is on file.
                </p>
              )}
              <div className="xs-toolbar" style={{ marginTop: 12 }}>
                {drawerFixableMissing.length ? (
                  <ActionButton
                    size="sm"
                    icon={<Pencil size={14} />}
                    onClick={() => openQuickCreate({ action: 'Edit Horse', horseId: animal.id })}
                  >
                    Complete passport
                  </ActionButton>
                ) : (
                  <ActionButton size="sm" onClick={() => navigate('/today')}>
                    Open Care Tasks
                  </ActionButton>
                )}
                <ActionButton size="sm" variant="primary" onClick={() => navigate('/sale-packets')}>
                  Open Sale Packets
                </ActionButton>
              </div>
            </Card>
          </div>
          {profitGate ? (
            <Card title="Money">
              <div className="xs-nba">
                <div className="xs-nba__label">Ranch Ops</div>
                <div className="xs-nba__title">See this horse's profit, margin, and safe sale price</div>
              </div>
              <p className="xs-muted" style={{ fontSize: 12.5, margin: '8px 0 12px' }}>
                {profitGate}
              </p>
              <ActionButton size="sm" variant="primary" onClick={() => navigate(billingPath)}>
                Upgrade to Ranch Ops
              </ActionButton>
            </Card>
          ) : money ? (
            <Card title="Money" link="Open Money view" onLink={() => navigate('/financials')}>
              <div style={{ marginBottom: 10 }}>
                <StatusChip tone={MONEY_STATUS[money.status].chip}>{MONEY_STATUS[money.status].label}</StatusChip>
              </div>
              <div className="xs-money motion-stagger">
                <button
                  type="button"
                  className="xs-money__card motion-lift"
                  style={motionIndex(0)}
                  onClick={() => navigate('/expenses')}
                >
                  <span className="xs-money__label">Invested</span>
                  <span className="xs-money__value">{formatCurrency(money.invested)}</span>
                  <span className="xs-money__meta">
                    {money.costBlindSpot ? 'Add a cost basis' : 'Cost basis + expenses'}
                  </span>
                </button>
                <button
                  type="button"
                  className="xs-money__card motion-lift"
                  style={motionIndex(1)}
                  onClick={() => navigate('/financials')}
                >
                  <span className="xs-money__label">{MONEY_STATUS[money.status].valueLabel}</span>
                  <span className="xs-money__value">{money.value > 0 ? formatCurrency(money.value) : '—'}</span>
                  <span className="xs-money__meta">
                    {money.status !== 'sold'
                      ? money.safeSalePrice > 0
                        ? `Protect at ${formatCurrency(money.safeSalePrice)}`
                        : 'Set an asking price'
                      : money.value > 0
                        ? 'Recorded sale'
                        : 'Record the sale amount'}
                  </span>
                </button>
                <button
                  type="button"
                  className="xs-money__card motion-lift"
                  style={motionIndex(2)}
                  onClick={() => navigate('/financials')}
                >
                  <span className="xs-money__label">Profit</span>
                  {money.value > 0 && !money.costBlindSpot ? (
                    <span className={`xs-money__value xs-money__value--${money.profit >= 0 ? 'up' : 'down'}`}>
                      {money.profit >= 0 ? '' : '−'}
                      {formatCurrency(Math.abs(money.profit))}
                    </span>
                  ) : (
                    <span className="xs-money__value">—</span>
                  )}
                  <span className="xs-money__meta">
                    {money.value > 0 && !money.costBlindSpot
                      ? `${formatPercent(Math.round(money.marginPercent))} margin`
                      : 'Needs a price and cost'}
                  </span>
                </button>
              </div>
              {money.underwater ? (
                <div className="xs-passport-gap" style={{ marginTop: 12 }}>
                  <div className="xs-passport-gap__head">
                    <span>Priced below break-even</span>
                    <StatusChip tone="danger">Raise to {formatCurrency(money.safeSalePrice)}</StatusChip>
                  </div>
                  <p className="xs-muted" style={{ fontSize: 12.5, margin: '4px 0 0' }}>
                    Selling {animal.name} at the current price would lock in a loss. Raise the ask to protect your
                    margin.
                  </p>
                </div>
              ) : null}
            </Card>
          ) : null}
        </>
      ) : null}

      {tab === 'Health' ? (
        <Card title="Health &amp; Care" link="Open Health &amp; Care" onLink={() => navigate('/health-care')}>
          {animal.medicalTimeline.length ? (
            <div className="xs-mlist">
              {animal.medicalTimeline.slice(0, 8).map((e) => (
                <div key={e.id} className="xs-mrow">
                  <span className="xs-mrow__main">
                    <span className="xs-mrow__title">{e.title}</span>
                    <span className="xs-mrow__detail">
                      {e.summary} · {e.date}
                    </span>
                  </span>
                  <StatusChip tone={e.severity === 'high' ? 'danger' : e.severity === 'medium' ? 'warning' : 'success'}>
                    {e.status ?? 'Logged'}
                  </StatusChip>
                </div>
              ))}
            </div>
          ) : (
            <p className="xs-muted" style={{ fontSize: 13, marginTop: 0 }}>
              No health records yet.{animal.lastVetVisit ? ` Last vet visit ${animal.lastVetVisit}.` : ''}
            </p>
          )}
          <ActionButton
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => openQuickCreate({ action: 'Add Health Record', horseId: animal.id })}
          >
            Add Health Record
          </ActionButton>
        </Card>
      ) : null}

      {tab === 'Documents' ? (
        <Card title="Documents" link="Open documents" onLink={() => navigate('/documents')}>
          {animal.documentFacts.length ? (
            <div className="xs-mlist">
              {animal.documentFacts.slice(0, 10).map((f) => (
                <div key={f.id} className="xs-mrow">
                  <span className="xs-mrow__main">
                    <span className="xs-mrow__title">{f.label}</span>
                    <span className="xs-mrow__detail">{f.value}</span>
                  </span>
                  <StatusChip
                    tone={f.decision === 'Accepted' ? 'success' : f.decision === 'Rejected' ? 'danger' : 'warning'}
                  >
                    {f.decision ?? 'Review'}
                  </StatusChip>
                </div>
              ))}
            </div>
          ) : (
            <p className="xs-muted" style={{ fontSize: 13, marginTop: 0 }}>
              No documents linked to this horse yet.
            </p>
          )}
        </Card>
      ) : null}

      {tab === 'Ownership' ? (
        <Card title="Ownership" link="Open Ownership" onLink={() => navigate('/ownership-chain')}>
          {animal.ownership.length ? (
            <div className="xs-mlist">
              {animal.ownership.map((o) => (
                <div key={o.id} className="xs-mrow">
                  <span className="xs-mrow__main">
                    <span className="xs-mrow__title">{o.name}</span>
                    <span className="xs-mrow__detail">
                      {o.role} · {o.share}%
                    </span>
                  </span>
                  <StatusChip tone="success">{o.share}%</StatusChip>
                </div>
              ))}
            </div>
          ) : (
            <p className="xs-muted" style={{ fontSize: 13, marginTop: 0 }}>
              No ownership stakes recorded.
            </p>
          )}
        </Card>
      ) : null}

      {tab === 'Breeding' ? (
        <Card title="Breeding & Foaling" link="Open Breeding" onLink={() => navigate('/breeding-foaling')}>
          {animal.breedingTimeline.length ? (
            <div className="xs-mlist">
              {animal.breedingTimeline.slice(0, 8).map((e) => (
                <div key={e.id} className="xs-mrow">
                  <span className="xs-mrow__main">
                    <span className="xs-mrow__title">{e.title}</span>
                    <span className="xs-mrow__detail">
                      {e.summary} · {e.date}
                    </span>
                  </span>
                  <StatusChip tone="info">{e.status ?? 'Logged'}</StatusChip>
                </div>
              ))}
            </div>
          ) : (
            <p className="xs-muted" style={{ fontSize: 13, marginTop: 0 }}>
              No active breeding records for this horse.
            </p>
          )}
          <ActionButton
            size="sm"
            icon={<Plus size={14} />}
            onClick={() => openQuickCreate({ action: 'Add Breeding Record', horseId: animal.id })}
          >
            Add Breeding Record
          </ActionButton>
        </Card>
      ) : null}

      {tab === 'Location' ? (
        <Card title="Location" link="Open Pastures" onLink={() => navigate('/pastures')}>
          <dl className="xs-kv">
            <dt>Ranch</dt>
            <dd>{animal.location.ranch || '—'}</dd>
            <dt>Barn</dt>
            <dd>{animal.location.barn || '—'}</dd>
            <dt>Pasture</dt>
            <dd>{animal.location.pasture || '—'}</dd>
            <dt>Stall</dt>
            <dd>{animal.location.stall || '—'}</dd>
          </dl>
          <ActionButton
            size="sm"
            icon={<Move size={14} />}
            onClick={() => openQuickCreate({ action: 'Move Horse', horseId: animal.id })}
          >
            Move Horse
          </ActionButton>
        </Card>
      ) : null}

      {tab === 'Tasks' ? (
        <Card title="Tasks" link="Open Work Queue" onLink={() => navigate('/today')}>
          {animal.alerts.length ? (
            <div className="xs-mlist">
              {animal.alerts.map((a) => (
                <div key={a.id} className="xs-mrow">
                  <span className="xs-mrow__main">
                    <span className="xs-mrow__title">{a.title}</span>
                    <span className="xs-mrow__detail">
                      {a.summary} · {a.module}
                    </span>
                  </span>
                  <StatusChip tone={a.severity === 'high' ? 'danger' : a.severity === 'medium' ? 'warning' : 'info'}>
                    Open
                  </StatusChip>
                </div>
              ))}
            </div>
          ) : (
            <p className="xs-muted" style={{ fontSize: 13, marginTop: 0 }}>
              No open tasks for this horse.
            </p>
          )}
        </Card>
      ) : null}

      {tab === 'Ready to Sell' ? (
        <Card title="Ready to Sell" link="Open sale packet" onLink={() => navigate('/sale-packets')}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
            <span className="xs-finbar__track" style={{ flex: 1 }}>
              <span
                className="xs-finbar__fill"
                style={{
                  width: `${readiness}%`,
                  background: readiness >= 95 ? 'var(--xbar-success)' : 'var(--xbar-warning)',
                }}
              />
            </span>
            <strong>{readiness}%</strong>
          </div>
          <div className="xs-mlist">
            <div className="xs-mrow">
              <span className="xs-mrow__main">
                <span className="xs-mrow__title">Packet status</span>
              </span>
              <StatusChip tone={packetReady ? 'success' : 'warning'}>
                {animal.readiness?.packetStatus ?? 'Review'}
              </StatusChip>
            </div>
            <div className="xs-mrow">
              <span className="xs-mrow__main">
                <span className="xs-mrow__title">Ready to share with buyers</span>
              </span>
              <StatusChip tone={packetReady ? 'success' : 'warning'}>{packetReady ? 'Verified' : 'Pending'}</StatusChip>
            </div>
            <div className="xs-mrow">
              <span className="xs-mrow__main">
                <span className="xs-mrow__title">Release blockers</span>
              </span>
              <StatusChip tone={animal.readiness?.blockers?.length ? 'danger' : 'success'}>
                {animal.readiness?.blockers?.length
                  ? `${animal.readiness.blockers.length} blocker${animal.readiness.blockers.length === 1 ? '' : 's'}`
                  : 'Clear'}
              </StatusChip>
            </div>
          </div>
        </Card>
      ) : null}

      {tab === 'Buyers' ? (
        <Card title="Buyers" link="Open buyer follow-up" onLink={() => navigate(buyerFollowUpPath())}>
          <dl className="xs-kv">
            <dt>Ask price</dt>
            <dd>{animal.sale?.askPrice ? formatCurrency(animal.sale.askPrice) : '—'}</dd>
            <dt>Inquiries</dt>
            <dd>{animal.sale?.inquiryCount ?? 0}</dd>
            <dt>Watchlist</dt>
            <dd>{animal.sale?.watchlistCount ?? 0}</dd>
            <dt>Buyer confidence</dt>
            <dd>{animal.sale?.buyerConfidence ?? 0}%</dd>
          </dl>
        </Card>
      ) : null}

      {tab === 'Timeline' ? (
        <Card title="Timeline">
          {animal.activity.length ? (
            <div className="xs-tl">
              {animal.activity.slice(0, 12).map((e) => (
                <div key={e.id} className="xs-tl__row">
                  <span className="xs-tl__dot" />
                  <span>
                    <div className="xs-tl__title">{e.title}</div>
                    <div className="xs-tl__time">
                      {e.summary} · {e.date}
                    </div>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="xs-muted" style={{ fontSize: 13, marginTop: 0 }}>
              No activity recorded yet.
            </p>
          )}
        </Card>
      ) : null}
    </>
  );
}
