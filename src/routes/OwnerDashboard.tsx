import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowUpRight, CreditCard, LogOut, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { XbarMark } from '@/components/BrandMark';
import {
  OwnerRequestError,
  ownerRequest,
  priceLabel,
  type OwnerDashboardData,
  type OwnerSubscription,
} from '@/lib/ownerDashboard';
import { useCloudStore } from '@/store/useCloudStore';
import { canPresentPurchaseFlow } from '@/lib/nativePlatform';
import './ownerDashboard.css';

const filters = [
  ['all', 'All subscriptions'],
  ['active', 'Active'],
  ['trialing', 'Trialing'],
  ['past_due', 'Past due'],
  ['unpaid', 'Unpaid'],
  ['canceled', 'Canceled'],
  ['incomplete', 'Incomplete'],
  ['incomplete_expired', 'Expired checkout'],
  ['paused', 'Paused'],
];
const readableStatus = (status: string) => filters.find(([id]) => id === status)?.[1] ?? status;
const date = (seconds: number | null) => (seconds ? new Date(seconds * 1000).toLocaleDateString() : 'Not available');

function StripeLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a className="owner-link" href={href} target="_blank" rel="noopener noreferrer">
      {children}
      <ArrowUpRight size={14} aria-hidden="true" />
    </a>
  );
}

function SubscriptionCard({ subscription: s }: { subscription: OwnerSubscription }) {
  const attention =
    ['past_due', 'unpaid', 'incomplete', 'paused'].includes(s.status) ||
    s.collectionPaused ||
    s.workspaces.length !== 1;
  return (
    <article className="owner-customer">
      <div className="owner-customer__heading">
        <div>
          <h3>{s.name || s.email || 'Customer details unavailable'}</h3>
          <p>{s.email || 'No billing email recorded'}</p>
        </div>
        <span className={`owner-status${attention ? ' owner-status--attention' : ''}`}>{readableStatus(s.status)}</span>
      </div>
      <div className="owner-customer__details">
        <div>
          <span className="owner-label">XBAR workspace</span>
          {s.workspaces.length ? (
            s.workspaces.map((w) => (
              <div key={w.id}>
                <strong>{w.name || 'Workspace unavailable'}</strong>
                <p>
                  {w.tier || 'Plan unknown'} · App billing: {w.billingState || 'Unknown'}
                </p>
              </div>
            ))
          ) : (
            <p className="owner-attention">No matching XBAR subscription link. Check payment and workspace access.</p>
          )}
          {s.workspaces.length > 1 && (
            <p className="owner-attention">Multiple workspaces linked. Review before changing billing.</p>
          )}
        </div>
        <div>
          <span className="owner-label">Unit price</span>
          {s.prices.length ? (
            s.prices.map((p, i) => (
              <div key={`${p.id}-${i}`}>
                <strong>{priceLabel(p)}</strong>
                <p>
                  Quantity: {p.quantity ?? 'Unknown'} · Period ends {date(p.periodEnd)}
                </p>
              </div>
            ))
          ) : (
            <p>Price unavailable — check Stripe.</p>
          )}
          {s.morePrices && <p>Additional prices in Stripe.</p>}
        </div>
        <div>
          <span className="owner-label">Billing schedule</span>
          <strong>
            {s.cancelAt
              ? `Cancels ${date(s.cancelAt)}`
              : s.cancelAtPeriodEnd
                ? 'Cancels at period end'
                : s.status === 'canceled'
                  ? 'Subscription ended'
                  : 'No cancellation scheduled'}
          </strong>
          {s.trialEnd && <p>Trial ends {date(s.trialEnd)}</p>}
          {s.collectionPaused && <p className="owner-attention">Payment collection paused</p>}
          <p>Created {date(s.createdAt)}</p>
        </div>
      </div>
      <footer>
        <span className="owner-id">{s.id}</span>
        <div>
          <StripeLink href={s.subscriptionUrl}>Manage subscription</StripeLink>
          {s.customerUrl && <StripeLink href={s.customerUrl}>Customer & invoices</StripeLink>}
        </div>
      </footer>
    </article>
  );
}

export default function OwnerDashboard() {
  const session = useCloudStore((s) => s.session);
  const cloudStatus = useCloudStore((s) => s.status);
  const signOut = useCloudStore((s) => s.signOut);
  const webDashboard = canPresentPurchaseFlow();
  const token = webDashboard ? (session?.access_token ?? '') : '';
  const [status, setStatus] = useState('all');
  const [pages, setPages] = useState<string[]>(['']);
  const [revision, setRevision] = useState(0);
  const [signOutError, setSignOutError] = useState('');
  const cursor = pages.at(-1) || '';
  const requestKey = `${token}:${status}:${cursor}:${revision}`;
  const [result, setResult] = useState<{
    key: string;
    data?: OwnerDashboardData;
    error?: string;
    denied?: boolean;
  } | null>(null);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 35_000);
    let active = true;
    const query = new URLSearchParams({ status, ...(cursor ? { after: cursor } : {}) });
    void ownerRequest<OwnerDashboardData>(`owner-dashboard?${query}`, token, controller.signal)
      .then((data) => {
        if (active) setResult({ key: requestKey, data });
      })
      .catch((error: unknown) => {
        if (active)
          setResult({
            key: requestKey,
            denied: error instanceof OwnerRequestError && [401, 403].includes(error.status),
            error:
              error instanceof OwnerRequestError
                ? error.message
                : 'The dashboard could not load. Refresh to try again.',
          });
      })
      .finally(() => clearTimeout(timer));
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [requestKey, token, status, cursor]);
  // Never display customer data belonging to an old session or filter, even
  // for the render before effect cleanup. No customer data is persisted.
  const current = result?.key === requestKey ? result : null;
  const data = current?.data;
  if (!webDashboard) return <Navigate to="/" replace />;
  if (!session && ['signed-out', 'unavailable'].includes(cloudStatus))
    return <Navigate to="/login" replace state={{ from: '/owner' }} />;
  const refresh = () => setRevision((n) => n + 1);
  const attention =
    data?.subscriptions.filter(
      (s) =>
        ['past_due', 'unpaid', 'incomplete', 'paused'].includes(s.status) ||
        s.collectionPaused ||
        s.workspaces.length !== 1,
    ).length ?? 0;
  return (
    <div className="owner-shell">
      <header className="owner-topbar">
        <Link to="/owner" aria-label="XBAR owner dashboard">
          <XbarMark width={100} height={57} />
        </Link>
        <span>
          <ShieldCheck size={16} aria-hidden="true" /> Owner access
        </span>
        <Link to="/">My ranch</Link>
        <button
          type="button"
          onClick={() => {
            void signOut().then((r) => {
              if (!r.ok) setSignOutError(r.message || 'Sign out failed. Try again.');
            });
          }}
        >
          <LogOut size={16} aria-hidden="true" />
          Sign out
        </button>
      </header>
      <main className="owner-main">
        <div className="owner-title">
          <div>
            <p className="owner-eyebrow">BUSINESS OVERVIEW</p>
            <h1>Your XBAR business</h1>
            <p>Customers, subscriptions, and the services that keep them running.</p>
          </div>
          <button className="xs-btn xs-btn--primary" type="button" onClick={refresh} disabled={!current}>
            <RefreshCw size={16} aria-hidden="true" /> Refresh
          </button>
        </div>
        {signOutError && <p role="alert">{signOutError}</p>}
        {!current && (
          <div className="owner-panel" role="status">
            Verifying owner access and loading billing…
          </div>
        )}
        {current?.error && (
          <div className="owner-panel" role="alert">
            <h2>{current.denied ? 'Owner access required' : 'Dashboard unavailable'}</h2>
            <p>{current.error}</p>
            {!current.denied && (
              <button type="button" className="xs-btn" onClick={refresh}>
                Try again
              </button>
            )}
            <Link to="/login">Go to sign in</Link>
          </div>
        )}
        {data && (
          <>
            {data.mode === 'test' && (
              <p className="owner-banner" role="status">
                TEST MODE — these are synthetic billing records, not real payments.
              </p>
            )}
            <section className="owner-metrics" aria-label="Current page summary">
              <div>
                <Users aria-hidden="true" />
                <span>Subscriptions on this page</span>
                <strong>{data.subscriptions.length}</strong>
                <small>
                  Page {pages.length} · {readableStatus(status)}
                </small>
              </div>
              <div>
                <CreditCard aria-hidden="true" />
                <span>Need attention on this page</span>
                <strong>{attention}</strong>
                <small>Payment issues or missing workspace links</small>
              </div>
              <div>
                <ShieldCheck aria-hidden="true" />
                <span>Billing configuration</span>
                <strong>{data.readiness.checks.billingReady ? 'Configured' : 'Needs attention'}</strong>
                <small>Configuration check; not proof of a successful payment</small>
              </div>
            </section>
            <section className="owner-panel owner-readiness" aria-labelledby="owner-readiness-title">
              <div>
                <p className="owner-eyebrow">LAUNCH & OPERATIONS</p>
                <h2 id="owner-readiness-title">What needs your attention</h2>
                <p>
                  Checked {new Date(data.fetchedAt).toLocaleString()}. Configuration checks do not verify inbox
                  delivery, recovery, or a complete purchase.
                </p>
              </div>
              <ul>
                {[...(data.readiness.reasons || []), ...(data.readiness.warnings || [])].map((message) => (
                  <li key={message}>{message}</li>
                ))}
                {!data.readiness.subsystems.remindersCron && <li>Reminder scheduling is not configured.</li>}
                <li>
                  Before inviting paying customers, verify a complete purchase, correct workspace access, email
                  delivery, and a recoverable backup.
                </li>
              </ul>
              <a href="https://github.com/Thunderhorse891/XBAR/issues/361" target="_blank" rel="noopener noreferrer">
                Review the prioritized launch audit <ArrowUpRight size={14} aria-hidden="true" />
              </a>
            </section>
            <section aria-labelledby="owner-customers-title">
              <div className="owner-section-heading">
                <div>
                  <h2 id="owner-customers-title">Customers & subscriptions</h2>
                  <p>Live subscription records from the connected Stripe account. All pages are available below.</p>
                </div>
                <div className="owner-actions">
                  <StripeLink href={data.billingUrl}>All subscriptions in Stripe</StripeLink>
                  <StripeLink href={data.paymentsUrl}>Payments & refunds</StripeLink>
                </div>
              </div>
              <div className="owner-toolbar">
                <label htmlFor="owner-status">Subscription status</label>
                <select
                  id="owner-status"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPages(['']);
                  }}
                >
                  {filters.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <span>Updated {new Date(data.fetchedAt).toLocaleTimeString()}</span>
              </div>
              <p className="owner-note">
                Manage plans, cancellations, invoices, and refunds in your authenticated Stripe dashboard. Unit prices
                exclude taxes and discounts; subscription status does not prove an invoice was paid.
              </p>
              {!data.subscriptions.length ? (
                <div className="owner-panel">
                  <h3>No subscriptions in this view</h3>
                  <p>
                    Try another status. This list does not include free accounts or XBAR trials that have not created a
                    Stripe subscription.
                  </p>
                </div>
              ) : (
                <div className="owner-customer-list">
                  {data.subscriptions.map((s) => (
                    <SubscriptionCard key={s.id} subscription={s} />
                  ))}
                </div>
              )}
              <nav className="owner-pagination" aria-label="Subscription pages">
                <button
                  className="xs-btn"
                  type="button"
                  disabled={pages.length === 1}
                  onClick={() => setPages((p) => p.slice(0, -1))}
                >
                  Previous
                </button>
                <span>
                  Page {pages.length}
                  {!data.nextCursor ? ' · Last page' : ''}
                </span>
                <button
                  className="xs-btn"
                  type="button"
                  disabled={!data.nextCursor}
                  onClick={() => {
                    if (data.nextCursor) setPages((p) => [...p, data.nextCursor!]);
                  }}
                >
                  Next
                </button>
              </nav>
            </section>
            <footer className="owner-footnote">
              This dashboard is restricted to your verified owner account. Ranch administrators cannot access it. Stripe
              links require your Stripe sign-in.
            </footer>
          </>
        )}
      </main>
    </div>
  );
}
