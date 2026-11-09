import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowUpRight, CreditCard, LogOut, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { XbarMark } from '@/components/BrandMark';
import {
  priceLabel,
  type OwnerAccountsData,
  type OwnerDashboardData,
  type OwnerReadinessData,
  type OwnerSubscription,
} from '@/lib/ownerDashboard';
import { useCloudStore } from '@/store/useCloudStore';
import { canPresentPurchaseFlow } from '@/lib/nativePlatform';
import { useOwnerResource } from '@/hooks/useOwnerResource';
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
const accountDate = (value: string | null) =>
  value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : 'Not recorded';

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
  const [accountPage, setAccountPage] = useState(1);
  const [signOutError, setSignOutError] = useState('');
  const cursor = pages.at(-1) || '';
  const query = new URLSearchParams({ status, ...(cursor ? { after: cursor } : {}) });
  const current = useOwnerResource<OwnerDashboardData>(`owner-dashboard?${query}`, token, revision);
  const operations = useOwnerResource<OwnerReadinessData>('owner-readiness', token, revision);
  const directory = useOwnerResource<OwnerAccountsData>(`owner-accounts?page=${accountPage}`, token, revision);
  const [deniedToken, setDeniedToken] = useState('');
  const refused = Boolean(current?.denied || operations?.denied || directory?.denied);
  useEffect(() => {
    if (refused) setDeniedToken(token);
  }, [refused, token]);
  // An authorization refusal from any section hides every section, including
  // data that finished earlier. Paging/refresh cannot clear that refusal.
  const denied = refused || Boolean(token && deniedToken === token);
  const data = current?.data;
  const readiness = operations?.data;
  const accounts = directory?.data;
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
          <button
            className="xs-btn xs-btn--primary"
            type="button"
            onClick={refresh}
            disabled={denied || (!current && !operations && !directory)}
          >
            <RefreshCw size={16} aria-hidden="true" /> Refresh
          </button>
        </div>
        {signOutError && <p role="alert">{signOutError}</p>}
        {denied ? (
          <div className="owner-panel" role="alert">
            <h2>Owner access required</h2>
            <p>Your owner access could not be verified. Sign in again to continue.</p>
            <Link to="/login">Go to sign in</Link>
          </div>
        ) : (
          <>
            {!operations && (
              <div className="owner-panel" role="status">
                Loading service status…
              </div>
            )}
            {operations?.error && (
              <div className="owner-panel" role="alert">
                <h2>Service status unavailable</h2>
                <p>{operations.error}</p>
              </div>
            )}
            {readiness && (
              <section className="owner-panel owner-readiness" aria-labelledby="owner-readiness-title">
                <div>
                  <p className="owner-eyebrow">LAUNCH & OPERATIONS</p>
                  <h2 id="owner-readiness-title">What needs your attention</h2>
                  <p>
                    Checked {new Date(readiness.fetchedAt).toLocaleString()}. Configuration checks do not verify inbox
                    delivery, recovery, or a complete purchase.
                  </p>
                </div>
                <ul>
                  {[...(readiness.readiness.reasons || []), ...(readiness.readiness.warnings || [])].map((message) => (
                    <li key={message}>{message}</li>
                  ))}
                  {!readiness.readiness.subsystems.remindersCron && <li>Reminder scheduling is not configured.</li>}
                  <li>
                    Before inviting paying customers, verify a complete purchase, correct workspace access, email
                    delivery, and a recoverable backup.
                  </li>
                </ul>
                <a href="https://github.com/Thunderhorse891/XBAR/issues/361" target="_blank" rel="noopener noreferrer">
                  Review the prioritized launch audit <ArrowUpRight size={14} aria-hidden="true" />
                </a>
              </section>
            )}
            <section aria-labelledby="owner-accounts-title">
              <div className="owner-section-heading">
                <div>
                  <h2 id="owner-accounts-title">Registered accounts</h2>
                  <p>
                    All sign-ups, including trials and accounts without a subscription. Browse 25 accounts per page.
                  </p>
                </div>
              </div>
              <p className="owner-note">
                Owned ranches and their stored app plans appear below. A plan label does not confirm payment. Customer
                records stay in each customer’s workspace.
              </p>
              {!directory && (
                <div className="owner-panel" role="status">
                  Loading registered accounts…
                </div>
              )}
              {directory?.error && (
                <div className="owner-panel" role="alert">
                  <h3>Account directory unavailable</h3>
                  <p>{directory.error}</p>
                </div>
              )}
              {accounts && (
                <>
                  {!accounts.accounts.length ? (
                    <div className="owner-panel">No registered accounts on this page.</div>
                  ) : (
                    <div className="owner-customer-list">
                      {accounts.accounts.map((account) => (
                        <article key={account.id} className="owner-customer">
                          <div className="owner-customer__heading">
                            <h3>{account.email || 'Email not recorded'}</h3>
                            <span className={`owner-status${account.emailConfirmed ? '' : ' owner-status--attention'}`}>
                              {account.emailConfirmed ? 'Email confirmed' : 'Email unconfirmed'}
                            </span>
                          </div>
                          <div className="owner-customer__details">
                            <div>
                              <span className="owner-label">Owned ranches</span>
                              {account.ownedWorkspaces.length ? (
                                account.ownedWorkspaces.map((space) => (
                                  <div key={space.id}>
                                    <strong>{space.name || 'Ranch name unavailable'}</strong>
                                    <p>
                                      {space.tier || 'Plan unknown'} · App billing: {space.billingState || 'Unknown'}
                                    </p>
                                  </div>
                                ))
                              ) : (
                                <p>No owned ranches recorded. This account may be a member of another ranch.</p>
                              )}
                            </div>
                            <div>
                              <span className="owner-label">Account created</span>
                              <p>{accountDate(account.createdAt)}</p>
                            </div>
                            <div>
                              <span className="owner-label">Last sign-in</span>
                              <p>{accountDate(account.lastSignInAt)}</p>
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  )}
                  <nav className="owner-pagination" aria-label="Account pages">
                    <button
                      type="button"
                      className="xs-btn"
                      aria-label="Previous account page"
                      disabled={accountPage === 1}
                      onClick={() => setAccountPage((p) => p - 1)}
                    >
                      Previous
                    </button>
                    <span>Page {accounts.page}</span>
                    <button
                      type="button"
                      className="xs-btn"
                      aria-label="Next account page"
                      disabled={!accounts.nextPage}
                      onClick={() => {
                        if (accounts.nextPage) setAccountPage(accounts.nextPage);
                      }}
                    >
                      Next
                    </button>
                  </nav>
                </>
              )}
            </section>
            {!current && (
              <div className="owner-panel" role="status">
                Loading billing…
              </div>
            )}
            {current?.error && (
              <div className="owner-panel" role="alert">
                <h2>Billing unavailable</h2>
                <p>{current.error}</p>
                <button type="button" className="xs-btn" onClick={refresh}>
                  Try again
                </button>
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
                    Manage plans, cancellations, invoices, and refunds in your authenticated Stripe dashboard. Unit
                    prices exclude taxes and discounts; subscription status does not prove an invoice was paid.
                  </p>
                  {!data.subscriptions.length ? (
                    <div className="owner-panel">
                      <h3>No subscriptions in this view</h3>
                      <p>
                        Try another status. This list does not include free accounts or XBAR trials that have not
                        created a Stripe subscription.
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
              </>
            )}
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
