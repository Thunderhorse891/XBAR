import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { MetricCard, Pill } from '@/components/app-ui';
import { completeFollowUp, followUpTiming, scheduleNextFollowUp, sortFollowUps } from '@/lib/salesFollowUp';
import { formatCompactCurrency, formatDateLabel } from '@/lib/format';
import { productEvent, productEventNames } from '@/lib/productEvents';
import { trackRuntimeEvent } from '@/lib/runtimeEvents';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import './operationsExperience.css';
import './followUpExperience.css';

export default function FollowUps() {
  const [params, setParams] = useSearchParams();
  const horses = useXbarStore((state) => state.horses);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const updateSalesLead = useXbarStore((state) => state.updateSalesLead);
  const pushToast = useUiStore((state) => state.pushToast);
  const workspaceId = useCloudStore((state) => state.workspaceId);
  const canManageSales = useCurrentRoleCapability('manageSales');
  const leads = useMemo(() => sortFollowUps([...salesLeads]), [salesLeads]);
  const selected = leads.find((lead) => lead.id === params.get('lead')) ?? leads[0];
  const overdue = leads.filter((lead) => followUpTiming(lead) === 'Overdue').length;
  const today = leads.filter((lead) => followUpTiming(lead) === 'Today').length;
  const offerValue = leads
    .filter((lead) => lead.stage === 'Offer')
    .reduce((sum, lead) => sum + (lead.offerAmount ?? 0), 0);
  const horse = horses.find((item) => item.id === selected?.horseId);
  const apply = (patch: Parameters<typeof updateSalesLead>[1], title: string, action: string) => {
    if (!selected) return;
    const result = updateSalesLead(selected.id, patch);
    pushToast({
      title: result.ok ? title : 'Lead update blocked',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    void trackRuntimeEvent({
      workspaceId,
      severity: result.ok ? 'info' : 'warning',
      ...productEvent(productEventNames.followUpAction, {
        action,
        success: result.ok,
        stageBefore: selected.stage,
        stageAfter: patch.stage ?? selected.stage,
        timingBefore: followUpTiming(selected),
      }),
    });
  };
  return (
    <div className="ops-experience follow-up-experience">
      <section className="ops-hero" aria-labelledby="follow-ups-title">
        <div>
          <div className="ops-kicker">Buyer momentum</div>
          <h1 id="follow-ups-title">Follow up while the buyer is warm</h1>
          <p>
            A focused workspace for completing buyer touches, protecting offer momentum, and making sure the next
            conversation is already scheduled.
          </p>
        </div>
        <div className="ops-hero__ledger">
          <span>Due today</span>
          <strong>{overdue + today}</strong>
          <small>
            {overdue} overdue | {leads.length} open prospects
          </small>
          <div className="ops-hero__mini-grid">
            <div>
              <span>Offers</span>
              <b>{leads.filter((lead) => lead.stage === 'Offer').length}</b>
            </div>
            <div>
              <span>Offer value</span>
              <b>{formatCompactCurrency(offerValue)}</b>
            </div>
          </div>
        </div>
      </section>
      <div className="ops-metric-grid">
        <MetricCard
          label="Overdue"
          value={String(overdue)}
          detail="Needs a touch now"
          tone={overdue ? 'rose' : 'emerald'}
          className="ops-metric-card"
        />
        <MetricCard
          label="Today"
          value={String(today)}
          detail="Planned for today"
          tone={today ? 'amber' : 'emerald'}
          className="ops-metric-card"
        />
        <MetricCard
          label="Offers"
          value={String(leads.filter((lead) => lead.stage === 'Offer').length)}
          detail="Protect active negotiations"
          tone="emerald"
          className="ops-metric-card"
        />
        <MetricCard
          label="Open prospects"
          value={String(leads.length)}
          detail="Every active buyer"
          tone="blue"
          className="ops-metric-card"
        />
      </div>
      <div className="follow-up-workspace">
        <section className="follow-up-queue ops-panel">
          <div className="ops-section-heading">
            <div>
              <span className="section-eyebrow">Call list</span>
              <h2>Buyer follow-ups</h2>
            </div>
            <Pill tone="blue">{leads.length}</Pill>
          </div>
          {leads.length ? (
            <div className="follow-up-list">
              {leads.map((lead) => {
                const timing = followUpTiming(lead);
                const leadHorse = horses.find((item) => item.id === lead.horseId);
                return (
                  <button
                    key={lead.id}
                    type="button"
                    className={`follow-up-row${selected?.id === lead.id ? ' follow-up-row--selected' : ''}`}
                    onClick={() => setParams({ lead: lead.id })}
                  >
                    <span>
                      <strong>{lead.name}</strong>
                      <small>
                        {leadHorse?.name ?? 'Horse pending'} | {lead.channel}
                      </small>
                    </span>
                    <span>
                      <Pill tone={timing === 'Overdue' ? 'rose' : timing === 'Today' ? 'amber' : 'slate'}>
                        {timing}
                      </Pill>
                      <small>{lead.nextFollowUp ? formatDateLabel(lead.nextFollowUp) : 'Set a date'}</small>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState
              compact
              title="No open buyer follow-ups"
              description="New inquiries and active buyers will appear here."
            />
          )}
        </section>
        <section className="follow-up-focus ops-panel">
          {selected ? (
            <>
              <div className="ops-section-heading">
                <div>
                  <span className="section-eyebrow">Current conversation</span>
                  <h2>{selected.name}</h2>
                </div>
                <Pill tone={selected.stage === 'Offer' ? 'emerald' : selected.stage === 'Qualified' ? 'blue' : 'amber'}>
                  {selected.stage}
                </Pill>
              </div>
              <div className="follow-up-focus__facts">
                <div>
                  <span>Horse</span>
                  <strong>{horse?.name ?? 'Pending'}</strong>
                </div>
                <div>
                  <span>Next touch</span>
                  <strong>{selected.nextFollowUp ? formatDateLabel(selected.nextFollowUp) : 'Not scheduled'}</strong>
                </div>
                <div>
                  <span>Last touch</span>
                  <strong>{formatDateLabel(selected.lastTouch)}</strong>
                </div>
                <div>
                  <span>Offer</span>
                  <strong>{selected.offerAmount ? formatCompactCurrency(selected.offerAmount) : 'No offer yet'}</strong>
                </div>
              </div>
              {selected.notes && <p className="follow-up-note">{selected.notes}</p>}
              <div className="follow-up-actions">
                <button
                  className="button button--primary"
                  type="button"
                  disabled={!canManageSales}
                  onClick={() => apply(completeFollowUp(selected), 'Follow-up completed', 'complete_and_schedule')}
                >
                  Complete touch and schedule next
                </button>
                <button
                  className="button button--ghost"
                  type="button"
                  disabled={!canManageSales}
                  onClick={() => apply(scheduleNextFollowUp(selected, 3), 'Follow-up scheduled', 'schedule_three_days')}
                >
                  Schedule in 3 days
                </button>
                <button
                  className="button button--ghost"
                  type="button"
                  disabled={!canManageSales || selected.stage === 'Offer'}
                  onClick={() =>
                    apply(
                      {
                        stage: selected.stage === 'New' ? 'Qualified' : 'Offer',
                        lastTouch: new Date().toISOString().slice(0, 10),
                      },
                      selected.stage === 'New' ? 'Lead qualified' : 'Lead moved to offer',
                      selected.stage === 'New' ? 'qualify' : 'move_to_offer',
                    )
                  }
                >
                  {selected.stage === 'New' ? 'Mark qualified' : 'Move to offer'}
                </button>
              </div>
            </>
          ) : (
            <EmptyState
              title="No buyer selected"
              description="Choose an open buyer to complete the next sales action."
            />
          )}
        </section>
      </div>
    </div>
  );
}
