import { useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Boxes,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  Coins,
  FileText,
  FolderOpen,
  Gauge,
  Home,
  LayoutDashboard,
  type LucideIcon,
  Map,
  Plus,
  Rocket,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Sprout,
  Users,
  Wheat,
} from 'lucide-react';
import { ProgressRing, QuickCreateMenu } from '@/components/saas';
import { GlobalCreateDrawer, createActions } from '@/components/saas/flows';
import { billingPath } from '@/lib/billingRoutes';
import { buyerFollowUpPath } from '@/lib/buyerRoutes';
import { buildCareBoardRows } from '@/lib/dashboardOps';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';

const XBAR_ICON = '/brand/xbar-app-icon.png';

type NavItem = { label: string; path: string; icon: LucideIcon; badgeKey?: 'docs' | 'transfers' | 'care' };
type NavGroup = { heading: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    heading: 'Ranch',
    items: [
      { label: 'Dashboard', path: '/', icon: LayoutDashboard },
      { label: 'Care Tasks', path: '/today', icon: ClipboardList },
      { label: 'Horses', path: '/horses', icon: Home },
      { label: 'Groups', path: '/herd-groups', icon: Users },
      { label: 'Pastures', path: '/pastures', icon: Map },
    ],
  },
  {
    heading: 'Care',
    items: [
      { label: 'Health', path: '/health-care', icon: Stethoscope, badgeKey: 'care' },
      { label: 'Breeding', path: '/breeding-foaling', icon: Sprout },
      { label: 'Feed & Supplies', path: '/feed', icon: Wheat },
    ],
  },
  {
    heading: 'Selling',
    items: [
      { label: 'Sales', path: '/sales', icon: Gauge },
      { label: 'Buyer follow-up', path: buyerFollowUpPath(), icon: Users },
      { label: 'Sale Packets', path: '/sale-packets', icon: FileText },
      { label: 'Ownership', path: '/ownership-chain', icon: ShieldCheck, badgeKey: 'transfers' },
    ],
  },
  {
    heading: 'Records',
    items: [
      { label: 'Documents', path: '/documents', icon: FolderOpen, badgeKey: 'docs' },
      { label: 'Equipment', path: '/equipment', icon: Boxes },
      { label: 'Expenses', path: '/expenses', icon: Coins },
      { label: 'Reports', path: '/reports', icon: Gauge },
    ],
  },
  {
    heading: 'Account',
    items: [
      { label: 'Settings', path: '/settings', icon: SettingsIcon },
      { label: 'Billing', path: billingPath, icon: Rocket },
    ],
  },
];

const mobileItems: { label: string; path: string; icon: LucideIcon }[] = [
  { label: 'Home', path: '/', icon: LayoutDashboard },
  { label: 'Work', path: '/today', icon: ClipboardList },
  { label: 'Horses', path: '/horses', icon: Home },
  { label: 'Sales', path: '/sales', icon: Gauge },
  { label: 'Documents', path: '/documents', icon: FolderOpen },
];

export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<'ops' | 'buyer'>('ops');

  const documents = useXbarStore((state) => state.documents);
  const horses = useXbarStore((state) => state.horses);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const subscription = useXbarStore((state) => state.subscription);
  const currentRole = useXbarStore((state) => state.currentRole);
  const cloudSession = useCloudStore((state) => state.session);
  const signOutCloud = useCloudStore((state) => state.signOut);
  const pushToast = useUiStore((state) => state.pushToast);
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const openQuickCreate = useUiStore((state) => state.openQuickCreate);

  const pendingReview = documents.filter((d) => d.state === 'Needs Review' || d.state === 'Matched').length;
  const pendingTransfers = ownershipRecords.filter((r) => r.transferStatus !== 'Clear').length;
  const careDueCount = useMemo(() => {
    const board = buildCareBoardRows(horses, documents, expenseReceipts);
    return board.filter((row) => row.signals.some((s) => s.status === 'due')).length;
  }, [horses, documents, expenseReceipts]);

  const badges: Record<string, number> = { docs: pendingReview, transfers: pendingTransfers, care: careDueCount };
  const notifications = pendingReview + pendingTransfers + careDueCount;

  const ranchName = workspaceProfile.ranchName || workspaceProfile.businessName || 'Your ranch';
  const planTier = subscription?.tier || 'Starter';
  const accountInitials = (cloudSession?.user?.email ?? currentRole ?? 'XB')
    .replace(/@.*/, '')
    .slice(0, 2)
    .toUpperCase();
  const ranchInitials =
    ranchName
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || 'XB';
  const setupSteps = [
    Boolean(workspaceProfile.ranchName),
    horses.length > 0,
    documents.length > 0,
    Boolean(workspaceProfile.defaultOwnerName),
  ];
  const setupProgress = Math.round((setupSteps.filter(Boolean).length / setupSteps.length) * 100);

  async function handleSignOut() {
    const result = await signOutCloud();
    pushToast({
      title: result.ok ? 'Signed out' : 'Sign-out failed',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok) navigate('/login', { replace: true });
  }

  function handleMode(next: 'ops' | 'buyer') {
    setMode(next);
    if (next === 'buyer') navigate(buyerFollowUpPath());
  }

  const createItems = createActions.map((label) => ({ label, onSelect: () => openQuickCreate({ action: label }) }));

  return (
    <div className="xs-shell">
      {/* ---------------------------------------------------------- Sidebar */}
      <aside className="xs-sidebar">
        <div className="xs-brand">
          <img className="xs-brand__tile" src={XBAR_ICON} alt="XBAR" />
          <span>
            <span className="xs-brand__word">XBAR</span>
            <span className="xs-brand__sub">Ranch records</span>
          </span>
        </div>

        <button type="button" className="xs-workspace" onClick={() => navigate('/settings')}>
          <span className="xs-workspace__logo">{ranchInitials}</span>
          <span className="xs-workspace__body">
            <span className="xs-workspace__name">{ranchName}</span>
            <span className="xs-workspace__plan">
              <Sparkles size={11} /> {planTier}
            </span>
          </span>
          <ChevronDown size={16} className="xs-workspace__chev" />
        </button>

        <button type="button" className="xs-setupbar" onClick={() => navigate('/getting-started')}>
          <ProgressRing value={setupProgress} size={32} />
          <span className="xs-setupbar__body">
            <span className="xs-setupbar__top">{setupProgress}% set up</span>
            <span className="xs-setupbar__sub">Finish getting started</span>
          </span>
        </button>

        <nav className="xs-nav" aria-label="Primary">
          {navGroups.map((group) => (
            <div key={group.heading}>
              <div className="xs-nav__section">{group.heading}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                const badge = item.badgeKey ? (badges[item.badgeKey] ?? 0) : 0;
                return (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === '/'}
                    className={({ isActive }) => `xs-nav__item${isActive ? ' xs-nav__item--active' : ''}`}
                  >
                    <Icon size={17} className="xs-nav__icon" />
                    <span className="xs-nav__label">{item.label}</span>
                    {badge > 0 ? <span className="xs-nav__badge">{badge}</span> : null}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="xs-sidebar__footer">
          <img className="xs-sidebar__wm" src={XBAR_ICON} alt="" aria-hidden="true" />
          <div className="xs-ranchcard">
            <span className="xs-ranchcard__avatar">{ranchInitials}</span>
            <span>
              <div className="xs-ranchcard__name">{ranchName}</div>
              <div className="xs-ranchcard__meta">{planTier} plan</div>
            </span>
          </div>
          <div className="xs-version">XBAR Platform · v2.0</div>
        </div>
      </aside>

      {/* -------------------------------------------------------------- Main */}
      <div className="xs-main">
        <header className="xs-topbar">
          <div className="xs-topbar__left">
            <span className="xs-seasonchip">
              <Sparkles size={14} /> {ranchName}
            </span>
            {notifications > 0 ? (
              <span className="xs-weatherchip">
                {notifications} need{notifications === 1 ? 's' : ''} attention
              </span>
            ) : (
              <span className="xs-weatherchip">Everything looks good</span>
            )}
          </div>

          {/* Opens the command palette — real global search across horses,
              documents, buyers, and modules (see InteractionSystem). */}
          <button
            type="button"
            className="xs-search"
            onClick={() => setCommandPaletteOpen(true)}
            aria-label="Search horses, documents, buyers, and modules"
          >
            <Search size={15} className="xs-search__icon" />
            <span className="xs-search__input xs-search__placeholder">Search horses, documents, buyers…</span>
            <kbd className="xs-search__kbd">⌘K</kbd>
          </button>

          <div className="xs-topbar__spacer" />

          <div className="xs-topbar__right">
            <div className="xs-toggle" role="tablist" aria-label="Workspace mode">
              <button
                type="button"
                className={`xs-toggle__btn${mode === 'ops' ? ' xs-toggle__btn--active' : ''}`}
                onClick={() => handleMode('ops')}
              >
                Ranch work
              </button>
              <button
                type="button"
                className={`xs-toggle__btn${mode === 'buyer' ? ' xs-toggle__btn--active' : ''}`}
                onClick={() => handleMode('buyer')}
              >
                Buyer view
              </button>
            </div>

            <QuickCreateMenu
              items={createItems}
              trigger={(open) => (
                <button type="button" className="xs-btn xs-btn--primary" onClick={open}>
                  <Plus size={15} /> Create
                </button>
              )}
            />

            <button
              type="button"
              className="xs-iconbtn"
              aria-label="Notifications"
              onClick={() => navigate('/reminders')}
            >
              <Bell size={17} />
              {notifications > 0 ? <span className="xs-iconbtn__badge">{notifications}</span> : null}
            </button>
            <button type="button" className="xs-iconbtn" aria-label="Help" onClick={() => setCommandPaletteOpen(true)}>
              <CircleHelp size={17} />
            </button>

            <button type="button" className="xs-btn" onClick={() => navigate('/settings')}>
              <Users size={15} /> Invite team
            </button>
            <button type="button" className="xs-btn xs-btn--brass" onClick={() => navigate(billingPath)}>
              <Rocket size={15} /> Billing
            </button>

            <QuickCreateMenu
              items={[
                { label: 'Settings', onSelect: () => navigate('/settings') },
                { label: 'Billing', onSelect: () => navigate(billingPath) },
                ...(cloudSession ? [{ label: 'Sign out', onSelect: () => void handleSignOut() }] : []),
              ]}
              trigger={(open) => (
                <button
                  type="button"
                  className="xs-avatar"
                  aria-label="Account menu"
                  title={cloudSession?.user?.email ?? 'Account'}
                  onClick={open}
                >
                  {accountInitials}
                </button>
              )}
            />
          </div>
        </header>

        <main className="xs-page">
          <Outlet />
        </main>

        <GlobalCreateDrawer />

        <nav className="xs-mobilebar" aria-label="Mobile navigation">
          {mobileItems.map(({ label, path, icon: Icon }) => {
            const active = path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);
            return (
              <NavLink
                key={path}
                to={path}
                end={path === '/'}
                className={`xs-mobilebar__btn${active ? ' xs-mobilebar__btn--active' : ''}`}
              >
                <Icon size={18} />
                {label}
              </NavLink>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
