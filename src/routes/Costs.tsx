import { type CSSProperties, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Receipt, Wheat } from 'lucide-react';
import { ActionButton, Card, PageHead, StatusChip } from '@/components/saas';
import { ProgressBar } from '@/components/app-ui';
import { Sparkline } from '@/components/dataviz/Charts';
import { type CostGroup, buildCostPerHorse, buildSubscriptionPayback } from '@/lib/costPerHorse';
import { formatCurrency, formatCurrencyCents, formatDateLabel, formatPercent } from '@/lib/format';
import { subscriptionPlans } from '@/lib/subscriptionPlans';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import './moneyIntelligence.css';

const GROUP_LABEL: Record<CostGroup, string> = {
  Feed: 'Feed, supplements & bedding',
  Care: 'Farrier, wormer & dental',
  Vet: 'Vet care',
  General: 'Travel & general',
};

// Stagger index for the motion system; the CSS var drives each child's delay.
const motionIndex = (index: number): CSSProperties => ({ ['--motion-index' as string]: index }) as CSSProperties;

// A receipt date is a calendar day. formatDateLabel reads a bare 'YYYY-MM-DD'
// as UTC midnight, which shows the day before anywhere west of UTC — so it is
// read at local noon instead.
function receiptDayLabel(date: string) {
  return formatDateLabel(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00` : date);
}

function shareLabel(fraction: number) {
  return fraction > 0 && fraction < 0.01 ? 'under 1%' : formatPercent(fraction * 100);
}

export default function Costs() {
  const navigate = useNavigate();
  const openQuickCreate = useUiStore((state) => state.openQuickCreate);
  const horses = useXbarStore((state) => state.horses);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  // The real subscription, not the owner-preview overlay: this screen reports
  // what the workspace pays, and a previewed tier is not a price anyone paid.
  const subscription = useXbarStore((state) => state.subscription);

  const costs = useMemo(
    () => buildCostPerHorse({ horses, receipts: expenseReceipts, salesLeads }),
    [horses, expenseReceipts, salesLeads],
  );
  // A workspace that has not bought a plan yet is measured against the list
  // price of the plan it is on, so the answer holds once it does.
  const planRate =
    subscription.monthlyRate > 0 ? subscription.monthlyRate : subscriptionPlans[subscription.tier].monthlyRate;
  const payback = useMemo(() => buildSubscriptionPayback(costs, planRate), [costs, planRate]);
  const trendValues = costs.trend.flatMap((point) => (point.perHorsePerDay === null ? [] : [point.perHorsePerDay]));
  const logFeed = () => openQuickCreate({ action: 'Add Expense' });

  const head = (
    <PageHead
      eyebrow="Money"
      title="Costs"
      subtitle="What each horse costs you per day, where the money goes, and which suppliers raised their prices — from the receipts you log."
      actions={
        <>
          <ActionButton variant="primary" icon={<Wheat size={15} />} onClick={logFeed}>
            Log feed purchase
          </ActionButton>
          <ActionButton icon={<Receipt size={15} />} onClick={() => navigate('/expenses')}>
            Open expenses
          </ActionButton>
        </>
      }
    />
  );

  if (costs.trackedDays === 0) {
    return (
      <>
        {head}
        <Card>
          <div className="xs-empty">
            <span className="xs-empty__icon">
              <Wheat size={26} />
            </span>
            <div className="xs-empty__title">
              {horses.length ? 'Log your first feed purchase' : 'Add a horse, then log a feed purchase'}
            </div>
            <div className="xs-empty__sub">
              {horses.length
                ? 'Enter the supplier, price, quantity and unit from your last hay or grain receipt. Cost per horse per day, monthly burn and supplier price tracking start from that one receipt.'
                : 'Costs are split across the horses in your care. Add your horses, then log the supplier, price and quantity from your last feed receipt to see what each horse costs per day.'}
            </div>
            {horses.length ? (
              <ActionButton variant="primary" onClick={logFeed}>
                Log feed purchase
              </ActionButton>
            ) : (
              <ActionButton variant="primary" onClick={() => openQuickCreate({ action: 'Add Horse' })}>
                Add first horse
              </ActionButton>
            )}
          </div>
        </Card>
      </>
    );
  }

  const trendDirection =
    costs.trendChangePercent === null
      ? null
      : costs.trendChangePercent > 0
        ? `Up ${costs.trendChangePercent}% in the last 30 days`
        : costs.trendChangePercent < 0
          ? `Down ${Math.abs(costs.trendChangePercent)}% in the last 30 days`
          : 'Flat over the last 30 days';

  return (
    <>
      {head}

      <div className="fin-hero motion-stagger">
        <div className="fin-stat fin-stat--hero" style={motionIndex(0)}>
          <span className="fin-stat__label">Cost per horse per day</span>
          <span className="fin-stat__value">
            {costs.perHorsePerDay === null ? '—' : formatCurrencyCents(costs.perHorsePerDay)}
          </span>
          {trendValues.length >= 2 ? (
            <Sparkline
              data={trendValues}
              tone="amber"
              height={44}
              label="Cost per horse per day, weekly, last 90 days"
            />
          ) : null}
          <span className="fin-stat__sub">
            {costs.horsesInCare
              ? `${costs.horsesInCare} horse${costs.horsesInCare === 1 ? '' : 's'} in care · last ${costs.perHorseDays} day${costs.perHorseDays === 1 ? '' : 's'} of receipts${trendDirection ? ` · ${trendDirection}` : ''}`
              : 'Add the horses in your care to split these costs per head.'}
          </span>
        </div>

        <div className="fin-stat" style={motionIndex(1)}>
          <span className="fin-stat__label">Monthly burn</span>
          <span className="fin-stat__value">{formatCurrency(costs.monthlyBurn)}</span>
          <span className="fin-stat__sub">
            {formatCurrency(costs.windowTotal)} logged over the last {costs.trackedDays} day
            {costs.trackedDays === 1 ? '' : 's'}, averaged to a month.
          </span>
        </div>

        <div className="fin-stat" style={motionIndex(2)}>
          <span className="fin-stat__label">Is XBAR paying for itself?</span>
          <span className="fin-stat__value">
            {payback.priceRiseOverpay > 0
              ? formatCurrencyCents(payback.priceRiseOverpay)
              : payback.planPerHorsePerDay !== null
                ? formatCurrencyCents(payback.planPerHorsePerDay)
                : '—'}
          </span>
          <span className="fin-stat__sub">
            {payback.priceRiseOverpay > 0
              ? `in supplier price rises flagged in the last 90 days${
                  payback.planMonthsCovered !== null
                    ? ` — ${payback.planMonthsCovered >= 1 ? `${payback.planMonthsCovered.toFixed(1)}×` : `${shareLabel(payback.planMonthsCovered)} of`} your ${subscription.tier} plan's monthly price`
                    : ''
                }.`
              : payback.planPerHorsePerDay !== null && payback.shareOfDailyCost !== null
                ? `XBAR ${subscription.tier} per horse per day — ${shareLabel(payback.shareOfDailyCost)} of what each horse already costs you.`
                : 'Add your horses and log receipts to measure the plan against what each horse costs.'}
          </span>
        </div>
      </div>

      <Card
        title="Where each day's cost goes"
        subtitle={
          costs.horsesInCare
            ? `Per horse per day over the last ${costs.perHorseDays} days.`
            : `Totals over the last ${costs.trackedDays} days — add horses to see the per-head figure.`
        }
      >
        <div className="fin-costs">
          {costs.groups
            .filter((group) => group.total > 0)
            .map((group) => (
              <div key={group.group} className="fin-cost__row">
                <div className="fin-cost__top">
                  <span>{GROUP_LABEL[group.group]}</span>
                  <span>
                    {group.perHorsePerDay === null
                      ? formatCurrency(group.total)
                      : `${formatCurrencyCents(group.perHorsePerDay)} / day`}{' '}
                    · {shareLabel(group.share)}
                  </span>
                </div>
                <ProgressBar value={Math.round(group.share * 100)} tone="amber" />
              </div>
            ))}
          {costs.groups.every((group) => group.total === 0) ? (
            <p className="fin-insight__detail">
              The receipts in this window are all tagged to horses that have sold, so none of them are split across the
              horses still in your care.
            </p>
          ) : null}
        </div>
      </Card>

      <Card
        title="Supplier price watch"
        subtitle="Each delivery's price per unit against the same supplier's last three deliveries of that product."
      >
        {costs.priceRises.length ? (
          <div className="fin-insights motion-stagger">
            {costs.priceRises.map((rise, index) => (
              <div
                key={`${rise.vendor}-${rise.category}-${rise.product}-${rise.unit}`}
                className="fin-insight fin-insight--risk"
                style={motionIndex(index)}
              >
                <span className="fin-insight__rail" aria-hidden="true" />
                <div>
                  <div className="fin-insight__title">
                    {rise.vendor}: {rise.product || rise.category} up {rise.risePercent}% per {rise.unit}{' '}
                    <StatusChip tone="danger">Price up</StatusChip>
                  </div>
                  <div className="fin-insight__detail">
                    {rise.category}: {formatCurrencyCents(rise.baselineUnitPrice)} →{' '}
                    {formatCurrencyCents(rise.latestUnitPrice)} per {rise.unit}
                    {rise.deliveriesSinceRise > 1
                      ? ` since ${receiptDayLabel(rise.risingSince)}. The ${rise.deliveriesSinceRise} deliveries since cost `
                      : ` on ${receiptDayLabel(rise.latestDate)}. That delivery cost `}
                    {formatCurrencyCents(rise.extraCost)} more than this supplier&apos;s price before the rise — worth
                    raising before the next order, or getting a second quote.
                  </div>
                </div>
                <span />
              </div>
            ))}
          </div>
        ) : costs.priceComparisons > 0 ? (
          <p className="fin-insight__detail" style={{ marginTop: 0 }}>
            No supplier has raised a price per unit in the last 90 days.
          </p>
        ) : costs.feedSuppliers.some((supplier) => supplier.latestUnitPrice !== null) ? (
          <p className="fin-insight__detail" style={{ marginTop: 0 }}>
            Not enough history to compare yet. XBAR needs two priced deliveries of the same product, from the same
            supplier and in the same unit, before it can spot a price rise.
          </p>
        ) : null}

        {costs.feedSuppliers.length ? (
          <div className="xs-mlist" style={{ marginTop: costs.priceRises.length ? 14 : 0 }}>
            {costs.feedSuppliers.map((supplier) => (
              <div key={supplier.vendor} className="xs-mrow">
                <div className="xs-mrow__main">
                  <div className="xs-mrow__title">{supplier.vendor}</div>
                  <div className="xs-mrow__detail">
                    {supplier.purchases} purchase{supplier.purchases === 1 ? '' : 's'} ·{' '}
                    {supplier.latestUnitPrice !== null && supplier.unit
                      ? `${formatCurrencyCents(supplier.latestUnitPrice)} per ${supplier.unit} last time`
                      : 'no price per unit yet'}
                  </div>
                </div>
                <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {formatCurrency(supplier.spend)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="xs-empty">
            <div className="xs-empty__title">No feed purchases in the last 90 days</div>
            <div className="xs-empty__sub">
              Log hay, grain, supplements or bedding with the supplier, quantity and unit to start tracking what each
              supplier charges.
            </div>
            <ActionButton variant="primary" onClick={logFeed}>
              Log feed purchase
            </ActionButton>
          </div>
        )}

        {costs.unpricedFeedPurchases > 0 ? (
          <p className="xs-field-hint" style={{ marginTop: 12 }}>
            {costs.unpricedFeedPurchases} feed purchase{costs.unpricedFeedPurchases === 1 ? ' was' : 's were'} logged
            without a quantity and unit, so {costs.unpricedFeedPurchases === 1 ? 'its' : 'their'} price per unit
            can&apos;t be compared. Add both when you log feed.
          </p>
        ) : null}
      </Card>

      {costs.horses.length ? (
        <Card
          title="Cost per horse per day"
          subtitle="Receipts tagged to each horse plus an even share of ranch-wide receipts. Tap one to open its record."
        >
          <div className="fin-ledger">
            <div className="fin-animal fin-animal__head">
              <span>Horse</span>
              <span className="fin-animal__cell--hide">Tagged to horse</span>
              <span className="fin-animal__cell--hide">Ranch-wide share</span>
              <span>Per day</span>
              <span />
            </div>
            {costs.horses.map((row) => (
              <button
                key={row.horseId}
                type="button"
                className="fin-animal motion-lift"
                onClick={() => navigate(`/horses/${row.horseId}`)}
              >
                <span className="fin-animal__name">
                  <span className="fin-animal__title">{row.horseName}</span>
                </span>
                <span className="fin-animal__cell fin-animal__cell--hide">{formatCurrency(row.direct)}</span>
                <span className="fin-animal__cell fin-animal__cell--hide">{formatCurrency(row.sharedShare)}</span>
                <span className="fin-animal__cell">{formatCurrencyCents(row.perDay)}</span>
                <ArrowUpRight className="fin-insight__go fin-animal__cell--hide" size={18} aria-hidden="true" />
              </button>
            ))}
          </div>
        </Card>
      ) : null}
    </>
  );
}
