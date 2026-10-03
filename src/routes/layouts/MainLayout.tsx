import { useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  Boxes,
  Calculator,
  CalendarClock,
  ChevronDown,
  ClipboardList,
  Coins,
  FileText,
  FolderOpen,
  Gauge,
  LayoutDashboard,
  type LucideIcon,
  Map,
  Plus,
  Menu,
  Rocket,
  Search,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Sprout,
  TrendingUp,
  Users,
  Wheat,
} from 'lucide-react';
import { ProgressRing, QuickCreateMenu } from '@/components/saas';
import { HorsesIcon } from '@/components/icons';
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { GlobalCreateDrawer, createActions } from '@/components/saas/flows';
import { billingPath } from '@/lib/billingRoutes';
import { buyerFollowUpPath } from '@/lib/buyerRoutes';
import { buildCareBoardRows } from '@/lib/dashboardOps';
import { buildExpiryRadar, expiryBellCount } from '@/lib/documentExpiry';
import { isSupabaseConfigured } from '@/lib/platformConfig';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';
import { useEffectiveSubscription } from '@/hooks/useOwnerPreview';

// 40KB touch icon for the 38px brand tile; the faded sidebar watermark
// renders at 250px, so it uses the 512px source to avoid upscaling. Both
// beat the 1.53MB app icon this replaced.
const XBAR_ICON = '/brand/apple-touch-icon.png';
const XBAR_WORDMARK = '/brand/xbar-wordmark.png';

type NavItem = {
  label: string;
  path: string;
  icon: LucideIcon | typeof HorsesIcon;
  badgeKey?: 'docs' | 'transfers' | 'care' | 'expiring';
};
type NavGroup = { heading: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    heading: 'Ranch',
    items: [
      { label: 'Dashboard', path: '/', icon: LayoutDashboard },
      { label: 'Care Tasks', path: '/today', icon: ClipboardList },
      { label: 'Horses', path: '/horses', icon: HorsesIcon },
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
      { label: 'Money', path: '/financials', icon: TrendingUp },
      { label: 'Costs', path: '/costs', icon: Calculator },
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
      { label: 'Expiring soon', path: '/expiring', icon: CalendarClock, badgeKey: 'expiring' },
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

const mobileItems: { label: string; path: string; icon: LucideIcon | typeof HorsesIcon }[] = [
  { label: 'Home', path: '/', icon: LayoutDashboard },
  { label: 'Work', path: '/today', icon: ClipboardList },
  { label: 'Horses', path: '/horses', icon: HorsesIcon },
  { label: 'Sales', path: '/sales', icon: Gauge },
  { label: 'Documents', path: '/documents', icon: FolderOpen },
];

export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [navigationOpen, setNavigationOpen] = useState(false);

  const documents = useXbarStore((state) => state.documents);
  const horses = useXbarStore((state) => state.horses);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const subscription = useEffectiveSubscription();
  const currentRole = useXbarStore((state) => state.currentRole);
  const cloudSession = useCloudStore((state) => state.session);
  const signOutCloud = useCloudStore((state) => state.signOut);
  const pushToast = useUiStore((state) => state.pushToast);
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const openQuickCreate = useUiStore((state) => state.openQuickCreate);

  const pendingReview = documents.filter((d) => d.state === 'Needs Review' || d.state === 'Matched').length;
  const pendingTransfers = ownershipRecords.filter((r) => r.transferStatus !== 'Clear').length;
  const careBoard = useMemo(
    () => buildCareBoardRows(horses, documents, expenseReceipts),
    [horses, documents, expenseReceipts],
  );
  const careDueCount = careBoard.filter((row) => row.signals.some((s) => s.status === 'due')).length;

  // The nav badge counts every paper expired or under 30 days; the bell adds
  // the ones careDueCount does not already hold.
  const expiryRadar = useMemo(() => buildExpiryRadar(documents, horses), [documents, horses]);
  const expiringCount = expiryRadar.attentionCount;
  const expiringForBell = expiryBellCount(expiryRadar, careBoard);

  const badges: Record<string, number> = {
    docs: pendingReview,
    transfers: pendingTransfers,
    care: careDueCount,
    expiring: expiringCount,
  };
  const notifications = pendingReview + pendingTransfers + careDueCount + expiringForBell;

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
  const setupDoneCount = setupSteps.filter(Boolean).length;
  const setupProgress = Math.round((setupDoneCount / setupSteps.length) * 100);

  async function handleSignOut() {
    const result = await signOutCloud();
    pushToast({
      title: result.ok ? 'Signed out' : 'Sign-out failed',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok) navigate('/login', { replace: true });
  }

  const createItems = createActions.map((label) => ({ label, onSelect: () => openQuickCreate({ action: label }) }));

  const renderNavigation = (label: string) => (
    <nav className="xs-nav" aria-label={label}>
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
                onClick={() => setNavigationOpen(false)}
                end={item.path === '/'}
                className={({ isActive }) => `xs-nav__item${isActive ? ' xs-nav__item--active' : ''}`}
              >
                <Icon width={17} height={17} className="xs-nav__icon" />
                <span className="xs-nav__label">{item.label}</span>
                {badge > 0 ? <span className="xs-nav__badge">{badge}</span> : null}
              </NavLink>
            );
          })}
        </div>
      ))}
    </nav>
  );

  return (
    <div className="xs-shell">
      {/* ---------------------------------------------------------- Sidebar */}
      <div className="xs-sidebar" role="complementary" aria-label="Workspace sidebar">
        <NavLink to="/" className="xs-brand" aria-label="XBAR dashboard">
          <img className="xs-brand__wordmark" src={XBAR_WORDMARK} width="550" height="170" alt="XBAR" />
          <span className="xs-brand__sub">Ranch workspace</span>
        </NavLink>

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
            <span className="xs-setupbar__top">Workspace basics</span>
            <span className="xs-setupbar__sub">
              {setupDoneCount} of {setupSteps.length} complete
            </span>
          </span>
        </button>

        {renderNavigation('Primary')}

        <div className="xs-sidebar__footer">
          <div className="xs-ranchcard">
            <span className="xs-ranchcard__avatar">{ranchInitials}</span>
            <span>
              <div className="xs-ranchcard__name">{ranchName}</div>
              <div className="xs-ranchcard__meta">{planTier} plan</div>
            </span>
          </div>
          <div className="xs-version">Your horses. Your records.</div>
        </div>
      </div>

      {/* -------------------------------------------------------------- Main */}
      <div className="xs-main">
        <header className="xs-topbar">
          <div className="xs-topbar__left">
            <Sheet open={navigationOpen} onOpenChange={setNavigationOpen}>
              <SheetTrigger asChild>
                <button type="button" className="xs-iconbtn xs-mobile-menu" aria-label="Open navigation">
                  <Menu size={20} />
                </button>
              </SheetTrigger>
              <SheetContent side="left" className="xs-navigation-sheet">
                <SheetTitle className="sr-only">Ranch navigation</SheetTitle>
                <SheetDescription className="sr-only">Open any area of your ranch workspace.</SheetDescription>
                <img className="xs-brand__wordmark" src={XBAR_WORDMARK} width="550" height="170" alt="XBAR" />
                {renderNavigation('All sections')}
              </SheetContent>
            </Sheet>
            <NavLink className="xs-mobile-brand" to="/" aria-label="XBAR dashboard">
              <img src={XBAR_ICON} width="38" height="38" alt="" />
            </NavLink>
            <span className="xs-topbar__ranch">{ranchName}</span>
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
            <QuickCreateMenu
              items={[
                { label: 'Notifications', onSelect: () => navigate('/reminders') },
                { label: 'Settings', onSelect: () => navigate('/settings') },
                { label: 'Invite team', onSelect: () => navigate('/settings') },
                { label: 'Help & search', onSelect: () => setCommandPaletteOpen(true) },
                { label: 'Billing', onSelect: () => navigate(billingPath) },
                ...(cloudSession
                  ? [{ label: 'Sign out', onSelect: () => void handleSignOut() }]
                  : isSupabaseConfigured()
                    ? [
                        {
                          label: 'Sign in',
                          onSelect: () =>
                            navigate('/login', { state: { from: `${location.pathname}${location.search}` } }),
                        },
                      ]
                    : []),
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

        {/* Keyed on the path so each navigation replays the motion-system page
            entrance (fade + rise) on .xs-page itself — no wrapper div, so the
            page's flex-column/gap still applies to the route's sections.
            Respects prefers-reduced-motion. */}
        <main key={location.pathname} className="xs-page motion-in">
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
                <Icon width={18} height={18} />
                {label}
              </NavLink>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
