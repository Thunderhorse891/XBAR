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
import { GlobalCreateDrawer, createActions, type CreateKey } from '@/components/saas/flows';
import { buildCareBoardRows } from '@/lib/dashboardOps';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useXbarStore } from '@/store/useXbarStore';
import { ranchSeason, ranchWeather, xbarRanch } from '@/data/xbarSaasMock';

type NavItem = { label: string; path: string; icon: LucideIcon; badgeKey?: 'docs' | 'transfers' | 'care' };
type NavGroup = { heading: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  {
    heading: 'Operations',
    items: [
      { label: 'Command Center', path: '/', icon: LayoutDashboard },
      { label: "Today's Work", path: '/today', icon: ClipboardList },
      { label: 'Animals', path: '/horses', icon: Home },
      { label: 'Herd Groups', path: '/herd-groups', icon: Users },
      { label: 'Pastures & Locations', path: '/pastures', icon: Map },
    ],
  },
  {
    heading: 'Care',
    items: [
      { label: 'Health & Care', path: '/medical', icon: Stethoscope, badgeKey: 'care' },
      { label: 'Breeding & Foaling', path: '/breeding', icon: Sprout },
      { label: 'Feed & Inventory', path: '/feed', icon: Wheat },
    ],
  },
  {
    heading: 'Transactions',
    items: [
      { label: 'Sales Pipeline', path: '/sales-pipeline', icon: Gauge },
      { label: 'Buyer Deal Rooms', path: '/buyer-deal-room', icon: Users },
      { label: 'Sale Packet Studio', path: '/sale-packet-studio', icon: FileText },
    ],
  },
  {
    heading: 'Records',
    items: [
      { label: 'Documents Vault', path: '/documents-vault', icon: FolderOpen, badgeKey: 'docs' },
      { label: 'Ownership Chain', path: '/ownership', icon: ShieldCheck, badgeKey: 'transfers' },
      { label: 'Equipment', path: '/assets', icon: Boxes },
      { label: 'Expenses', path: '/expenses', icon: Coins },
    ],
  },
  {
    heading: 'Account',
    items: [
      { label: 'Reports', path: '/reports', icon: Gauge },
      { label: 'Settings', path: '/settings', icon: SettingsIcon },
    ],
  },
];

const whatsNew = ['Release Blocker detection', 'Buyer Deal Rooms', 'Sale Packet Studio'];

const mobileItems: { label: string; path: string; icon: LucideIcon }[] = [
  { label: 'Home', path: '/', icon: LayoutDashboard },
  { label: 'Work', path: '/today', icon: ClipboardList },
  { label: 'Animals', path: '/horses', icon: Home },
  { label: 'Pipeline', path: '/sales-pipeline', icon: Gauge },
  { label: 'Docs', path: '/documents', icon: FolderOpen },
];

export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setMode] = useState<'ops' | 'buyer'>('ops');
  const [createAction, setCreateAction] = useState<CreateKey | null>(null);

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
  const canManageBilling = useCurrentRoleCapability('manageBilling');

  const pendingReview = documents.filter((d) => d.state === 'Needs Review' || d.state === 'Matched').length;
  const pendingTransfers = ownershipRecords.filter((r) => r.transferStatus !== 'Clear').length;
  const careDueCount = useMemo(() => {
    const board = buildCareBoardRows(horses, documents, expenseReceipts);
    return board.filter((row) => row.signals.some((s) => s.status === 'due')).length;
  }, [horses, documents, expenseReceipts]);

  const badges: Record<string, number> = { docs: pendingReview, transfers: pendingTransfers, care: careDueCount };
  const notifications = pendingReview + pendingTransfers + careDueCount;

  const ranchName = workspaceProfile.ranchName || workspaceProfile.businessName || xbarRanch.name;
  const planTier = subscription?.tier || xbarRanch.plan;
  const accountInitials = (cloudSession?.user?.email ?? currentRole ?? 'XB').replace(/@.*/, '').slice(0, 2).toUpperCase();
  const setupProgress = xbarRanch.setupProgress;

  async function handleSignOut() {
    const result = await signOutCloud();
    pushToast({ title: result.ok ? 'Signed out' : 'Sign-out failed', message: result.message, tone: result.ok ? 'success' : 'error' });
    if (result.ok) navigate('/login', { replace: true });
  }

  function handleMode(next: 'ops' | 'buyer') {
    setMode(next);
    if (next === 'buyer') navigate('/buyer-deal-room');
  }

  function handleSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const q = (e.target as HTMLInputElement).value.trim();
      if (q) navigate(`/horses?search=${encodeURIComponent(q)}`);
    }
  }

  const createItems = createActions.map((label) => ({ label, onSelect: () => setCreateAction(label) }));

  return (
    <div className="xs-shell">
      {/* ---------------------------------------------------------- Sidebar */}
      <aside className="xs-sidebar">
        <button type="button" className="xs-workspace" onClick={() => navigate('/settings')}>
          <span className="xs-workspace__logo">{xbarRanch.initials}</span>
          <span className="xs-workspace__body">
            <span className="xs-workspace__name">{ranchName}</span>
            <span className="xs-workspace__plan"><Sparkles size={11} /> {planTier}</span>
          </span>
          <ChevronDown size={16} className="xs-workspace__chev" />
        </button>

        <button type="button" className="xs-setupbar" onClick={() => navigate('/getting-started')}>
          <ProgressRing value={setupProgress} size={32} />
          <span className="xs-setupbar__body">
            <span className="xs-setupbar__top">{setupProgress}% Ranch setup</span>
            <span className="xs-setupbar__sub">Finish onboarding</span>
          </span>
        </button>

        <nav className="xs-nav" aria-label="Primary">
          {navGroups.map((group) => (
            <div key={group.heading}>
              <div className="xs-nav__section">{group.heading}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                const badge = item.badgeKey ? badges[item.badgeKey] ?? 0 : 0;
                return (
                  <NavLink key={item.path} to={item.path} end={item.path === '/'} className={({ isActive }) => `xs-nav__item${isActive ? ' xs-nav__item--active' : ''}`}>
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
          <div className="xs-ranchcard">
            <span className="xs-ranchcard__avatar">{xbarRanch.initials}</span>
            <span>
              <div className="xs-ranchcard__name">{ranchName}</div>
              <div className="xs-ranchcard__meta">{xbarRanch.id}</div>
            </span>
          </div>
          <div className="xs-whatsnew">
            <div className="xs-whatsnew__title"><Sparkles size={13} /> What's New</div>
            <div className="xs-whatsnew__list">
              {whatsNew.map((item) => (
                <div key={item} className="xs-whatsnew__row"><span className="xs-whatsnew__dot" /> {item}</div>
              ))}
            </div>
          </div>
          <div className="xs-version">XBAR Platform · v2.0</div>
        </div>
      </aside>

      {/* -------------------------------------------------------------- Main */}
      <div className="xs-main">
        <header className="xs-topbar">
          <div className="xs-topbar__left">
            <span className="xs-seasonchip"><Sparkles size={14} /> {ranchSeason.label}</span>
            <span className="xs-weatherchip">
              {ranchWeather.tempF}°F · {ranchWeather.label}
              <span className="xs-weatherchip__risk">· {ranchWeather.risk}</span>
            </span>
          </div>

          <label className="xs-search">
            <Search size={15} className="xs-search__icon" />
            <input className="xs-search__input" placeholder="Search animals, documents, buyers, deals…" onKeyDown={handleSearchKey} aria-label="Search" />
          </label>

          <div className="xs-topbar__spacer" />

          <div className="xs-topbar__right">
            <div className="xs-toggle" role="tablist" aria-label="Workspace mode">
              <button type="button" className={`xs-toggle__btn${mode === 'ops' ? ' xs-toggle__btn--active' : ''}`} onClick={() => handleMode('ops')}>Ranch Ops</button>
              <button type="button" className={`xs-toggle__btn${mode === 'buyer' ? ' xs-toggle__btn--active' : ''}`} onClick={() => handleMode('buyer')}>Buyer Portal</button>
            </div>

            <QuickCreateMenu
              items={createItems}
              trigger={(open) => (
                <button type="button" className="xs-btn xs-btn--primary" onClick={open}>
                  <Plus size={15} /> Create
                </button>
              )}
            />

            <button type="button" className="xs-iconbtn" aria-label="Notifications" onClick={() => navigate('/reminders')}>
              <Bell size={17} />
              {notifications > 0 ? <span className="xs-iconbtn__badge">{notifications}</span> : null}
            </button>
            <button type="button" className="xs-iconbtn" aria-label="Help" onClick={() => setCommandPaletteOpen(true)}>
              <CircleHelp size={17} />
            </button>

            <button type="button" className="xs-btn" onClick={() => navigate('/settings')}><Users size={15} /> Invite Team</button>
            <button type="button" className="xs-btn xs-btn--brass" onClick={() => navigate(canManageBilling ? '/subscriptions' : '/getting-started')}><Rocket size={15} /> Upgrade</button>

            <button type="button" className="xs-avatar" aria-label="Account" title={cloudSession?.user?.email ?? 'Account'} onClick={() => (cloudSession ? void handleSignOut() : navigate('/settings'))}>
              {accountInitials}
            </button>
          </div>
        </header>

        <main className="xs-page">
          <Outlet />
        </main>

        <GlobalCreateDrawer action={createAction} onClose={() => setCreateAction(null)} />

        <nav className="xs-mobilebar" aria-label="Mobile navigation">
          {mobileItems.map(({ label, path, icon: Icon }) => {
            const active = path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);
            return (
              <NavLink key={path} to={path} end={path === '/'} className={`xs-mobilebar__btn${active ? ' xs-mobilebar__btn--active' : ''}`}>
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
