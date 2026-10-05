import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Ban, MessageSquare, Phone, Send, ShieldCheck, Users } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import {
  buildBuyerOfferPatch,
  buyerDepositStatuses,
  buyerOfferStatuses,
  createBuyerOfferDraft,
  type BuyerOfferDraft,
} from '@/lib/buyerOffers';
import { buyerFollowUpPath } from '@/lib/buyerRoutes';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import { useCloudStore } from '@/store/useCloudStore';
import { getCapabilityDeniedMessage, hasRoleCapability } from '@/lib/permissions';
import { events, track } from '@/lib/telemetry';
import type { SalesLead } from '@/types/xbar';

type Readiness = 'Ready' | 'Not ready';
const readinessTone = { Ready: 'success', 'Not ready': 'warning' } as const;
const initials = (s: string) =>
  s
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

export default function BuyerDealRoom() {
  const navigate = useNavigate();
  const { leadId: routeLeadId } = useParams<{ leadId?: string }>();
  const pushToast = useUiStore((s) => s.pushToast);
  const leads = useXbarStore((s) => s.salesLeads);
  const horses = useXbarStore((s) => s.horses);
  const updateSalesLead = useXbarStore((s) => s.updateSalesLead);
  const logBuyerRoomEvent = useXbarStore((state) => state.logBuyerRoomEvent);
  const currentRole = useXbarStore((state) => state.currentRole);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const canManageSales = useCurrentRoleCapability('manageSales');
  const cloud = useCloudStore.getState();
  const actionContext = { workspace: cloud.workspaceId, user: cloud.session?.user.id, profile: workspaceProfile };
  const changingReadiness = useRef(false);
  const [readinessError, setReadinessError] = useState('');
  const [selectedId, setSelectedId] = useState<string>(() => routeLeadId ?? leads[0]?.id ?? '');
  const [recordingOffer, setRecordingOffer] = useState(false);
  const [offerDraft, setOfferDraft] = useState<BuyerOfferDraft>(() => createBuyerOfferDraft());
  const toast = (m: string) => pushToast({ title: 'Buyer follow-up', message: m, tone: 'success' });

  const horseName = useMemo(() => {
    const map = new Map(horses.map((h) => [h.id, h.name]));
    return (l: SalesLead) => map.get(l.horseId) ?? 'Unlinked horse';
  }, [horses]);

  // This is an internal preparation flag. It cannot prove or revoke access to
  // a listing token, shared link, or an already downloaded packet.
  const readinessOf = (l: SalesLead): Readiness => (l.shareReady ? 'Ready' : 'Not ready');
  const offerOf = (l: SalesLead) => l.offerAmount;

  const selected = useMemo(() => {
    const targetId = routeLeadId ?? selectedId;
    return leads.find((r) => r.id === targetId) ?? leads[0];
  }, [leads, routeLeadId, selectedId]);

  useEffect(() => {
    if (!selected) return;
    if (!routeLeadId && !selectedId) setSelectedId(selected.id);
    if (routeLeadId && selected.id !== routeLeadId) navigate(buyerFollowUpPath(selected.id), { replace: true });
  }, [navigate, routeLeadId, selected, selectedId]);

  useEffect(() => {
    setRecordingOffer(false);
    setReadinessError('');
    setOfferDraft(createBuyerOfferDraft(selected));
    // Reset only when the selected lead's identity changes — deliberately not
    // when its content updates (e.g. after saving an offer), which would wipe
    // an in-progress draft. `selected` is read fresh but excluded on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id]);

  function updateOfferDraft<K extends keyof BuyerOfferDraft>(key: K, value: BuyerOfferDraft[K]) {
    setOfferDraft((current) => ({ ...current, [key]: value }));
  }

  function openOfferForm() {
    setOfferDraft(createBuyerOfferDraft(selected));
    setRecordingOffer(true);
  }

  function saveOffer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;

    const built = buildBuyerOfferPatch({ ...offerDraft, existingNotes: selected.notes });
    if (!built.ok) {
      pushToast({ title: 'Offer not saved', message: built.message, tone: 'error' });
      return;
    }

    const saved = updateSalesLead(selected.id, built.patch);
    if (!saved.ok) {
      pushToast({ title: 'Offer not saved', message: saved.message, tone: 'error' });
      return;
    }

    track(events.buyerOfferRecorded, { id: selected.id, amount: built.amount, status: built.patch.offerStatus });
    toast('Offer recorded');
    setRecordingOffer(false);
  }

  function markNotReady() {
    if (!selected || changingReadiness.current) return;
    const fail = (message: string) => {
      setReadinessError(message);
      pushToast({ title: 'Readiness change not confirmed', message, tone: 'error' });
    };
    const sameContext = () => {
      const now = useCloudStore.getState();
      return (
        now.workspaceId === actionContext.workspace &&
        now.session?.user.id === actionContext.user &&
        useXbarStore.getState().workspaceProfile === actionContext.profile
      );
    };
    const live = useXbarStore.getState().salesLeads.find((lead) => lead.id === selected.id);
    if (!sameContext() || !live) {
      fail('The buyer or ranch changed. Review the current buyer before continuing.');
      return;
    }
    // A stale second click after the first acknowledged state change is a no-op.
    if (!live.shareReady) return;
    if (live !== selected) {
      fail('The buyer changed. Review the current buyer before continuing.');
      return;
    }
    if (!hasRoleCapability(useXbarStore.getState().currentRole, 'manageSales')) {
      fail(getCapabilityDeniedMessage('manageSales'));
      return;
    }
    changingReadiness.current = true;
    setReadinessError('');
    let updated = false;
    try {
      const result = updateSalesLead(selected.id, { shareReady: false });
      if (!result.ok) {
        fail(result.message);
        return;
      }
      if (!sameContext()) {
        fail('The ranch changed before this action could be confirmed. Check the buyer in the original ranch.');
        return;
      }
      const changed = useXbarStore.getState().salesLeads.find((lead) => lead.id === selected.id);
      if (!changed || changed.shareReady !== false) {
        fail('The readiness change could not be verified. Check the buyer before trying again.');
        return;
      }
      updated = true;
      const history = selected.horseId
        ? logBuyerRoomEvent({
            horseId: selected.horseId,
            kind: 'deal-status',
            actor: currentRole,
            note: `Marked ${selected.name} not ready for sharing. Existing links were not revoked.`,
          })
        : { ok: true };
      track(events.buyerReadinessChanged, { id: selected.id, ready: false });
      const message = history.ok
        ? 'Marked not ready for sharing in this workspace. Existing links and downloaded packets are unchanged.'
        : 'Readiness changed in this workspace, but its history entry could not be recorded. Existing links and downloaded packets are unchanged.';
      if (!history.ok) setReadinessError(message);
      pushToast({ title: 'Sharing readiness updated', message, tone: history.ok ? 'info' : 'warning' });
    } catch {
      const message = updated
        ? 'Readiness changed in this workspace, but its history entry could not be confirmed. Existing links and downloaded packets are unchanged.'
        : 'The readiness change could not be confirmed. Check the buyer before trying again.';
      setReadinessError(message);
      pushToast({ title: 'Readiness change not confirmed', message, tone: updated ? 'warning' : 'error' });
    } finally {
      changingReadiness.current = false;
    }
  }

  if (!selected) {
    return (
      <>
        <PageHead
          eyebrow="Selling"
          title="Buyer follow-up"
          subtitle="See what each buyer has, what they offered, and what needs a reply."
          actions={
            <ActionButton variant="primary" icon={<Send size={15} />} onClick={() => navigate('/sale-packets')}>
              Open Sale Packets
            </ActionButton>
          }
        />
        <Card>
          <div className="xs-empty">
            <span className="xs-empty__icon">
              <Users size={26} />
            </span>
            <div className="xs-empty__title">No buyers yet</div>
            <div className="xs-empty__sub">
              Prepare sale packets and add buyer notes so offers and next steps stay together.
            </div>
            <ActionButton variant="primary" onClick={() => navigate('/sale-packets')}>
              Prepare Sale Packet
            </ActionButton>
          </div>
        </Card>
      </>
    );
  }

  const selectedReadiness = readinessOf(selected);
  const selOffer = offerOf(selected);

  return (
    <>
      <PageHead
        eyebrow="Selling"
        title="Buyer follow-up"
        subtitle="See what each buyer has, what they offered, and what needs a reply."
        actions={
          <ActionButton variant="primary" icon={<Send size={15} />} onClick={() => navigate('/sales')}>
            Open sales
          </ActionButton>
        }
      />

      <div className="xs-md">
        {/* master list */}
        <div className="xs-md__list">
          <div className="xs-md__listhead">
            <span>Buyers</span>
            <span>{leads.length}</span>
          </div>
          {leads.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`xs-mdrow${r.id === selected.id ? ' xs-mdrow--active' : ''}`}
              onClick={() => {
                track(events.buyerSelected, { id: r.id });
                setSelectedId(r.id);
                navigate(buyerFollowUpPath(r.id));
              }}
            >
              <span className="xs-mdrow__avatar">{initials(r.name)}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="xs-mdrow__name">{r.name}</span>
                <span className="xs-mdrow__meta">
                  {horseName(r)} · {r.lastTouch}
                </span>
              </span>
              <StatusChip tone={readinessTone[readinessOf(r)]}>{readinessOf(r)}</StatusChip>
            </button>
          ))}
        </div>

        {/* detail pane */}
        <div className="xs-md__detail">
          <div className="xs-detailhead">
            <div>
              <div className="xs-detailhead__name">{selected.name}</div>
              <div className="xs-detailhead__meta">
                Interested in {horseName(selected)} · last active {selected.lastTouch}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                <StatusChip tone={readinessTone[selectedReadiness]}>
                  Sharing {selectedReadiness.toLowerCase()}
                </StatusChip>
                {selOffer ? (
                  <StatusChip tone="success">Offer received</StatusChip>
                ) : (
                  <StatusChip tone="neutral">No offer yet</StatusChip>
                )}
              </div>
            </div>
            <div className="xs-toolbar">
              <ActionButton
                size="sm"
                icon={<Ban size={14} />}
                disabled={!canManageSales || !selected.shareReady}
                onClick={markNotReady}
              >
                Mark not ready
              </ActionButton>
              <ActionButton
                size="sm"
                variant="primary"
                icon={<ShieldCheck size={14} />}
                onClick={() => navigate(selected.horseId ? `/sale-packets?horse=${selected.horseId}` : '/sale-packets')}
              >
                Prepare documents
              </ActionButton>
            </div>
          </div>

          {readinessError ? (
            <p className="field-error" role="alert">
              {readinessError}
            </p>
          ) : null}
          <p className="xs-muted">
            Sharing readiness is an internal note. Manage listing links separately; existing links and downloaded
            packets are unchanged.
          </p>
          <ActionButton size="sm" onClick={() => navigate('/shared-access')}>
            Manage listing links
          </ActionButton>

          <div className="xs-grid-3">
            <Card>
              <div className="xs-card__sub">Stage</div>
              <div style={{ marginTop: 6 }}>
                <StatusChip
                  tone={selected.stage === 'Closed' ? 'success' : selected.stage === 'Offer' ? 'warning' : 'info'}
                >
                  {selected.stage}
                </StatusChip>
              </div>
            </Card>
            <Card>
              <div className="xs-card__sub">Channel</div>
              <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{selected.channel}</div>
            </Card>
            <Card>
              <div className="xs-card__sub">Sharing readiness</div>
              <div style={{ marginTop: 6 }}>
                <StatusChip tone={readinessTone[selectedReadiness]}>{selectedReadiness}</StatusChip>
              </div>
            </Card>
          </div>

          <Card title="Offer">
            {recordingOffer ? (
              <form className="xs-form" onSubmit={saveOffer}>
                <div className="xs-grid-3">
                  <label>
                    <span className="xs-field-label">Offer amount</span>
                    <input
                      className="xs-input"
                      type="number"
                      min="1"
                      step="1"
                      inputMode="decimal"
                      value={offerDraft.amount}
                      onChange={(e) => updateOfferDraft('amount', e.target.value)}
                      required
                    />
                  </label>
                  <label>
                    <span className="xs-field-label">Status</span>
                    <select
                      className="xs-select"
                      value={offerDraft.status}
                      onChange={(e) => updateOfferDraft('status', e.target.value as BuyerOfferDraft['status'])}
                    >
                      {buyerOfferStatuses.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="xs-field-label">Follow-up date</span>
                    <input
                      className="xs-input"
                      type="date"
                      value={offerDraft.followUpDate}
                      onChange={(e) => updateOfferDraft('followUpDate', e.target.value)}
                    />
                  </label>
                </div>

                <div className="xs-grid-3">
                  <label>
                    <span className="xs-field-label">Counteroffer</span>
                    <input
                      className="xs-input"
                      type="number"
                      min="1"
                      step="1"
                      inputMode="decimal"
                      value={offerDraft.counterOffer}
                      onChange={(e) => updateOfferDraft('counterOffer', e.target.value)}
                    />
                  </label>
                  <label>
                    <span className="xs-field-label">Deposit amount</span>
                    <input
                      className="xs-input"
                      type="number"
                      min="1"
                      step="1"
                      inputMode="decimal"
                      value={offerDraft.depositAmount}
                      onChange={(e) => updateOfferDraft('depositAmount', e.target.value)}
                    />
                  </label>
                  <label>
                    <span className="xs-field-label">Deposit status</span>
                    <select
                      className="xs-select"
                      value={offerDraft.depositStatus}
                      onChange={(e) =>
                        updateOfferDraft('depositStatus', e.target.value as BuyerOfferDraft['depositStatus'])
                      }
                    >
                      {buyerDepositStatuses.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label>
                  <span className="xs-field-label">Buyer note</span>
                  <textarea
                    className="xs-textarea"
                    rows={3}
                    value={offerDraft.buyerNote}
                    onChange={(e) => updateOfferDraft('buyerNote', e.target.value)}
                    placeholder="Terms, contingencies, timing, or seller notes."
                  />
                </label>

                <div className="xs-toolbar">
                  <button
                    type="button"
                    className="xs-btn xs-btn--ghost xs-btn--sm"
                    onClick={() => setRecordingOffer(false)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="xs-btn xs-btn--primary xs-btn--sm">
                    Save offer
                  </button>
                </div>
              </form>
            ) : selOffer ? (
              <dl className="xs-kv">
                <dt>Status</dt>
                <dd>
                  <StatusChip tone="success">{selected.offerStatus ?? 'Offer received'}</StatusChip>
                </dd>
                <dt>Amount</dt>
                <dd style={{ fontWeight: 700 }}>${selOffer.toLocaleString()}</dd>
                {selected.counterOfferAmount ? (
                  <>
                    <dt>Counter</dt>
                    <dd>${selected.counterOfferAmount.toLocaleString()}</dd>
                  </>
                ) : null}
                {selected.depositAmount ? (
                  <>
                    <dt>Deposit</dt>
                    <dd>
                      ${selected.depositAmount.toLocaleString()} · {selected.depositStatus ?? 'Not Requested'}
                    </dd>
                  </>
                ) : null}
                {selected.nextFollowUp ? (
                  <>
                    <dt>Next follow-up</dt>
                    <dd>{selected.nextFollowUp}</dd>
                  </>
                ) : null}
                <dt>Updated</dt>
                <dd>
                  {selected.offerUpdatedAt
                    ? new Date(selected.offerUpdatedAt).toLocaleDateString()
                    : selected.lastTouch}
                </dd>
              </dl>
            ) : (
              <>
                <p className="xs-muted" style={{ fontSize: 13, margin: '0 0 12px' }}>
                  No offer recorded yet for this buyer.
                </p>
                <ActionButton size="sm" variant="primary" onClick={openOfferForm}>
                  Record Offer
                </ActionButton>
              </>
            )}
            {!recordingOffer && selOffer ? (
              <div className="xs-toolbar" style={{ marginTop: 12 }}>
                <ActionButton size="sm" onClick={openOfferForm}>
                  Update offer
                </ActionButton>
              </div>
            ) : null}
          </Card>

          <Card title="Follow-up & notes">
            <dl className="xs-kv">
              <dt>Next follow-up</dt>
              <dd>{selected.nextFollowUp ?? 'Not scheduled'}</dd>
              <dt>Notes</dt>
              <dd>{selected.notes ?? '—'}</dd>
            </dl>
            <div className="xs-toolbar" style={{ marginTop: 12 }}>
              <ActionButton
                size="sm"
                icon={<MessageSquare size={14} />}
                onClick={() => navigate(buyerFollowUpPath(selected.id))}
              >
                Open follow-up
              </ActionButton>
              <ActionButton
                size="sm"
                icon={<Phone size={14} />}
                onClick={() => navigate(buyerFollowUpPath(selected.id))}
              >
                Plan call
              </ActionButton>
              <ActionButton
                size="sm"
                icon={<Send size={14} />}
                onClick={() => navigate(selected.horseId ? `/sale-packets?horse=${selected.horseId}` : '/sale-packets')}
              >
                Share documents
              </ActionButton>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
