import type { ComponentType, SVGProps } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { XbarMark } from '@/components/BrandMark';
import { CommandPalette } from '@/components/CommandPalette';
import { RightDrawer } from '@/components/RightDrawer';
import { WorkspaceHelp, type HelpSection } from '@/components/WorkspaceHelp';
import { useGlobalKeyboard } from '@/hooks/useGlobalKeyboard';
import {
  AddIcon,
  AssetsIcon,
  BellIcon,
  BreedingIcon,
  DashboardIcon,
  DocumentsIcon,
  DotsIcon,
  HorsesIcon,
  MedicalIcon,
  OwnershipIcon,
  SalesIcon,
  SearchIcon,
  SettingsIcon,
  MarketplaceIcon,
  SharedAccessIcon,
  SubscriptionIcon,
  WeatherIcon,
} from '@/components/icons';
import { buildCareBoardRows } from '@/lib/dashboardOps';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useCurrentRoleWorkspace, useXbarStore } from '@/store/useXbarStore';

type NavItem = {
  label: string;
  path: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  section: 'Command' | 'Operations' | 'Platform';
  requires?: 'billing' | 'settings';
  badgeKey?: 'transfers' | 'care' | 'docs' | 'reminders';
};

const navItems: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: DashboardIcon, section: 'Command' },
  { label: 'Horses', path: '/horses', icon: HorsesIcon, section: 'Command' },
  { label: 'Ownership', path: '/ownership', icon: OwnershipIcon, section: 'Command', badgeKey: 'transfers' },
  { label: 'Documents', path: '/documents', icon: DocumentsIcon, section: 'Command', badgeKey: 'docs' },
  { label: 'Health', path: '/medical', icon: MedicalIcon, section: 'Operations', badgeKey: 'care' },
  { label: 'Breeding', path: '/breeding', icon: BreedingIcon, section: 'Operations' },
  { label: 'Sales', path: '/sales', icon: SalesIcon, section: 'Operations' },
  { label: 'Expenses', path: '/expenses', icon: SubscriptionIcon, section: 'Operations' },
  { label: 'Reminders', path: '/reminders', icon: BellIcon, section: 'Operations', badgeKey: 'reminders' },
  { label: 'Equipment', path: '/assets', icon: AssetsIcon, section: 'Operations' },
  { label: 'Weather', path: '/weather', icon: WeatherIcon, section: 'Operations' },
  { label: 'Marketplace', path: '/marketplace', icon: MarketplaceIcon, section: 'Platform' },
  { label: 'Sale Listings', path: '/shared-access', icon: SharedAccessIcon, section: 'Platform' },
  { label: 'Subscriptions', path: '/subscriptions', icon: SubscriptionIcon, section: 'Platform', requires: 'billing' },
  { label: 'Settings', path: '/settings', icon: SettingsIcon, section: 'Platform', requires: 'settings' },
];

const routeLabels: Record<string, string> = {
  '/': 'Dashboard',
  '/horses': 'Horses',
  '/documents': 'Documents',
  '/ownership': 'Ownership',
  '/medical': 'Health',
  '/breeding': 'Breeding',
  '/sales': 'Sales',
  '/expenses': 'Expenses',
  '/reminders': 'Reminders',
  '/assets': 'Equipment',
  '/weather': 'Weather',
  '/subscriptions': 'Subscriptions',
  '/marketplace': 'Marketplace',
  '/shared-access': 'Sale Listings',
  '/settings': 'Settings',
};

const routeHelp: Record<string, HelpSection[]> = {
  'Dashboard': [
    { label: 'Start here', text: 'Watch care, ownership, documents, sales, weather, and spending in one place.' },
    { label: 'Next move', text: 'Open the highest-risk card first. XBAR should tell you what needs a human decision.' },
  ],
  Horses: [
    { label: 'Profile', text: 'Each horse should become a complete command file.' },
    { label: 'Create', text: 'New horse record should save confirmed data only.' },
  ],
  Ownership: [
    { label: 'Proof', text: 'Use this area for owners, percentages, documents, transfers, and history.' },
    { label: 'Control', text: 'No sale or transfer should move without source records.' },
  ],
  Documents: [
    { label: 'Vault', text: 'Upload first. Assign, approve, and keep the document chain clean.' },
    { label: 'Privacy', text: 'Only approved ready-to-share files should reach shared listings.' },
  ],
  Health: [
    { label: 'Care', text: 'Coggins, vaccines, dental, wormer, and treatment records belong here.' },
    { label: 'Dates', text: 'Do not guess due dates. Use records users can verify.' },
  ],
  Breeding: [
    { label: 'Program', text: 'Track pairings, milestones, contracts, and foaling work.' },
    { label: 'Proof', text: 'Breeding decisions should connect back to files and history.' },
  ],
  Sales: [
    { label: 'Pipeline', text: 'Keep lead movement, record readiness, and follow-ups visible.' },
    { label: 'Sale packets', text: 'Share only when the horse and documents are ready.' },
  ],
  Expenses: [
    { label: 'Ledger', text: 'Log costs while the context is still fresh.' },
    { label: 'Connect', text: 'Receipts should connect to horses, care, and documents.' },
  ],
  Reminders: [
    { label: 'Queue', text: 'This is the work list for due care, papers, docs, and sale follow-ups.' },
    { label: 'Confidence', text: 'A reminder should always show the source of the work.' },
  ],
  'Equipment': [
    { label: 'Assets', text: 'Track equipment, kits, feed supply, transport, and service work.' },
    { label: 'Field use', text: 'Keep mobile actions short and readable.' },
  ],
  Weather: [
    { label: 'Forecast', text: 'Use weather for turnout, hauling, and handling windows.' },
    { label: 'Location', text: 'Set the ranch location in Settings for better daily context.' },
  ],
  Subscriptions: [
    { label: 'Billing', text: 'Show plan state clearly. Do not imply Stripe billing unless it is configured.' },
    { label: 'Limits', text: 'Storage, seats, listings, and documents should be easy to understand.' },
  ],
  Marketplace: [
    { label: 'Board', text: 'Only Market Ready horses show here. Update listing state on the horse profile.' },
    { label: 'Leads', text: 'Captured inquiries feed directly into the Sales pipeline.' },
  ],
  'Sale Listings': [
    { label: 'Listings', text: 'Sale listing links need approved, sanitized records only.' },
    { label: 'Proof', text: 'Preview before making any horse public.' },
  ],
  Settings: [
    { label: 'Ranch', text: 'Manage defaults, members, sync, and backups.' },
    { label: 'Recovery', text: 'Use backups before large imports or cloud changes.' },
  ],
  'Horse Profile': [
    { label: 'Command file', text: 'Identity, care, ownership, documents, sales, and history should read as one record.' },
    { label: 'Missing data', text: 'Unknown should stay unknown until the user verifies it.' },
  ],
};

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function NavSection({ title, items, badges }: { title: string; items: NavItem[]; badges: Record<string, number> }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="px-3 text-[10px] font-bold uppercase tracking-[0.22em] text-[#3d5064]">{title}</div>
      <div className="flex flex-col gap-[1px]">
        {items.map(({ label, path, icon: Icon, badgeKey }) => {
          const badge = badgeKey ? (badges[badgeKey] ?? 0) : 0;
          return (
            <NavLink
              key={label}
              to={path}
              end={path === '/'}
              className={({ isActive }) =>
                classNames(
                  'group flex items-center gap-3 border-l-[3px] px-3 py-[9px] text-[13px] font-medium transition-colors duration-150',
                  isActive
                    ? 'border-[#2F8DFF] bg-[rgba(47,141,255,0.1)] text-white'
                    : 'border-transparent text-[#6b8499] hover:border-[#1e3044] hover:bg-[rgba(255,255,255,0.03)] hover:text-[#c2ccd6]',
                )
              }
            >
              <Icon className="h-[17px] w-[17px] shrink-0" />
              <span className="flex-1">{label}</span>
              {badge > 0 ? (
                <span className={classNames('nav-badge', badge <= 3 ? 'nav-badge--blue' : '')}>
                  {badge}
                </span>
              ) : null}
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}

export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const currentRole = useXbarStore((state) => state.currentRole);
  const subscription = useXbarStore((state) => state.subscription);
  const documents = useXbarStore((state) => state.documents);
  const horses = useXbarStore((state) => state.horses);
  const ownershipRecords = useXbarStore((state) => state.ownershipRecords);
  const expenseReceipts = useXbarStore((state) => state.expenseReceipts);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const cloudStatus = useCloudStore((state) => state.status);
  const cloudSession = useCloudStore((state) => state.session);
  const signOutCloud = useCloudStore((state) => state.signOut);
  const roleWorkspace = useCurrentRoleWorkspace();
  const pushToast = useUiStore((state) => state.pushToast);
  const openCommandPalette = useUiStore((state) => state.openCommandPalette);
  const openDrawer = useUiStore((state) => state.openDrawer);
  const canCreateHorse = useCurrentRoleCapability('createHorse');
  const canUploadDocuments = useCurrentRoleCapability('uploadDocuments');
  const canManageBilling = useCurrentRoleCapability('manageBilling');
  const canManageSettings = useCurrentRoleCapability('manageSettings');
  const canSyncCloud = useCurrentRoleCapability('syncCloud');

  const visibleNavItems = useMemo(() => navItems.filter((item) => {
    if (item.requires === 'billing') return canManageBilling;
    if (item.requires === 'settings') return canManageSettings;
    return true;
  }), [canManageBilling, canManageSettings]);

  const sections = {
    Command: visibleNavItems.filter((item) => item.section === 'Command'),
    Operations: visibleNavItems.filter((item) => item.section === 'Operations'),
    Platform: visibleNavItems.filter((item) => item.section === 'Platform'),
  };
  const mobilePrimaryPaths = new Set(['/', '/horses', '/documents', '/sales']);
  const mobileMoreItems = visibleNavItems.filter((item) => !mobilePrimaryPaths.has(item.path));
  const pendingReview = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Matched').length;
  const pendingTransfers = ownershipRecords.filter((record) => record.transferStatus !== 'Clear').length;
  const activeSales = salesLeads.filter((lead) => lead.stage !== 'Closed').length;

  const careDueCount = useMemo(() => {
    const board = buildCareBoardRows(horses, documents, expenseReceipts);
    return board.filter((row) => row.signals.some((signal) => signal.status === 'due')).length;
  }, [horses, documents, expenseReceipts]);

  const navBadges = useMemo<Record<string, number>>(() => ({
    transfers: pendingTransfers,
    care: careDueCount,
    docs: pendingReview,
    reminders: pendingTransfers + careDueCount + pendingReview,
  }), [pendingTransfers, careDueCount, pendingReview]);

  const opsUrgency = pendingTransfers > 0 ? 'urgent' : careDueCount > 0 ? 'warning' : 'clear';

  const currentLabel = location.pathname.startsWith('/horses/') ? 'Horse Profile' : routeLabels[location.pathname] ?? 'Ranch';
  const helpSections = routeHelp[currentLabel] ?? routeHelp['Dashboard'];
  const accountLabel = cloudSession?.user?.email ?? currentRole;

  useGlobalKeyboard();

  useEffect(() => {
    setHelpOpen(false);
    setMobileMoreOpen(false);
  }, [location.pathname]);

  const handleCloudSignOut = async () => {
    const result = await signOutCloud();
    pushToast({
      title: result.ok ? 'Signed out' : 'Sign-out failed',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok) {
      navigate('/login', { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-[#0D1117] lg:grid lg:grid-cols-[240px,1fr]">
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside className="hidden min-h-screen flex-col gap-5 border-r border-[rgba(48,54,61,0.8)] bg-[#0D1117] px-4 py-5 text-[#8B949E] lg:flex">

        {/* Brand lockup */}
        <div className="flex items-center gap-3 px-1">
          <div className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-lg border border-[rgba(48,54,61,0.9)] bg-[rgba(255,255,255,0.03)] p-1">
            <XbarMark title="XBAR logo" className="h-full w-full" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[0.96rem] font-extrabold uppercase tracking-[0.14em] text-[#E6EDF3]">{workspaceProfile.businessName || 'XBAR'}</div>
            <div className="text-[9px] font-bold uppercase tracking-[0.22em] text-[#3d5064]">Operational Infrastructure</div>
          </div>
        </div>

        {/* Ranch status card */}
        <div className="rounded-xl border border-[rgba(48,54,61,0.9)] bg-[#161B22] p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[9px] font-bold uppercase tracking-[0.22em] text-[#3d5064]">Ranch Status</div>
            <span className={classNames('ops-pulse')}>
              <span className={classNames('ops-pulse__dot', opsUrgency === 'urgent' ? 'ops-pulse__dot--urgent' : opsUrgency === 'warning' ? 'ops-pulse__dot--warning' : '')} />
            </span>
          </div>
          <div className="mt-2 text-[0.88rem] font-bold leading-tight text-[#C2CCD6]">{workspaceProfile.ranchName || workspaceProfile.businessName || 'Primary ranch'}</div>
          <div className="mt-0.5 text-[11px] text-[#4a6275]">{roleWorkspace.label}</div>
          <div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px]">
            <span className="rounded-md border border-[rgba(48,54,61,0.9)] bg-[#0D1117] px-2 py-1.5 text-[#5a7086]">{horses.length} horses</span>
            <span className={classNames(
              'rounded-md border px-2 py-1.5',
              pendingTransfers > 0
                ? 'border-[rgba(248,81,73,0.25)] bg-[rgba(248,81,73,0.08)] text-[#F85149]'
                : 'border-[rgba(48,54,61,0.9)] bg-[#0D1117] text-[#5a7086]',
            )}>{pendingTransfers} transfers</span>
            <span className={classNames(
              'rounded-md border px-2 py-1.5',
              pendingReview > 0
                ? 'border-[rgba(210,153,34,0.25)] bg-[rgba(210,153,34,0.08)] text-[#D29922]'
                : 'border-[rgba(48,54,61,0.9)] bg-[#0D1117] text-[#5a7086]',
            )}>{pendingReview} docs</span>
            <span className="rounded-md border border-[rgba(48,54,61,0.9)] bg-[#0D1117] px-2 py-1.5 text-[#5a7086]">{activeSales} buyers</span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <span className="inline-flex min-h-[22px] items-center rounded-md border border-[rgba(48,54,61,0.9)] bg-[rgba(255,255,255,0.03)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#4a6275]">{subscription.tier}</span>
            <span className="inline-flex min-h-[22px] items-center rounded-md border border-[rgba(47,141,255,0.2)] bg-[rgba(47,141,255,0.08)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#2F8DFF]">{cloudStatus === 'signed-in' ? 'Cloud sync' : 'Browser'}</span>
          </div>
        </div>

        {/* Navigation sections */}
        <NavSection title="Command" items={sections.Command} badges={navBadges} />
        <NavSection title="Operations" items={sections.Operations} badges={navBadges} />
        <NavSection title="Platform" items={sections.Platform} badges={navBadges} />

        {/* Footer */}
        <div className="mt-auto border-t border-[rgba(48,54,61,0.6)] pt-3.5 text-[11px] text-[#3d5064]">
          <div className="font-bold uppercase tracking-[0.12em] text-[#3d5064]">XBAR · Horse Operations</div>
          <div className="mt-1 text-[#2e4050]">{expenseReceipts.length} receipts · {documents.length} files · {horses.length} horses</div>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-col bg-[#0D1117]">

        {/* Topbar */}
        <header className="sticky top-0 z-10 border-b border-[rgba(48,54,61,0.9)] bg-[rgba(13,17,23,0.94)] backdrop-blur">
          <div className="flex min-h-[58px] flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="flex items-center gap-2.5">
              <div className="text-[0.88rem] font-extrabold tracking-[0.01em] text-[#E6EDF3]">{currentLabel}</div>
              <span className={classNames(
                'inline-flex min-h-[22px] items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.14em]',
                pendingReview || pendingTransfers
                  ? 'border-[rgba(210,153,34,0.25)] bg-[rgba(210,153,34,0.08)] text-[#D29922]'
                  : 'border-[rgba(47,141,255,0.2)] bg-[rgba(47,141,255,0.08)] text-[#2F8DFF]',
              )}>
                {pendingReview || pendingTransfers ? `${pendingReview + pendingTransfers} open` : 'Ready'}
              </span>
            </div>

            <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                className="relative flex h-9 min-w-[200px] max-w-[380px] flex-1 cursor-text items-center gap-2 rounded-md border border-[rgba(56,63,72,1)] bg-[#1C2128] pl-3 pr-3 text-left text-[13px] transition-colors duration-150 hover:border-[rgba(86,93,102,1)]"
                onClick={openCommandPalette}
                aria-label="Open command palette"
              >
                <SearchIcon className="h-[16px] w-[16px] shrink-0 text-[#8B949E]" aria-hidden="true" />
                <span className="flex-1 text-[#4a6275]">Search…</span>
                <kbd className="hidden items-center gap-0.5 rounded border border-[rgba(56,63,72,1)] bg-[rgba(255,255,255,0.04)] px-1.5 py-px text-[10px] font-bold text-[#4a6275] sm:flex">
                  ⌘K
                </kbd>
              </button>

              <div className="hidden h-9 items-center gap-2.5 rounded-md border border-[rgba(56,63,72,1)] bg-[#1C2128] px-3 text-[13px] font-semibold text-[#C2CCD6] md:inline-flex">
                <span className="max-w-[160px] truncate">{accountLabel}</span>
                <span className="inline-flex rounded border border-[rgba(48,54,61,0.9)] bg-[rgba(255,255,255,0.04)] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[#5a7086]">{cloudSession ? currentRole : 'Browser'}</span>
              </div>

              <button
                className="inline-flex h-9 items-center justify-center rounded-md border border-[rgba(56,63,72,1)] bg-[#1C2128] px-3 text-[13px] font-semibold text-[#C2CCD6] transition-colors duration-150 hover:border-[rgba(86,93,102,1)] hover:bg-[#21262D]"
                type="button"
                onClick={() => setHelpOpen(true)}
              >
                Help
              </button>

              {cloudSession && canSyncCloud ? (
                <button
                  className="inline-flex h-9 items-center justify-center rounded-md border border-[rgba(56,63,72,1)] bg-[#1C2128] px-3 text-[13px] font-semibold text-[#C2CCD6] transition-colors duration-150 hover:border-[rgba(248,81,73,0.4)] hover:bg-[rgba(248,81,73,0.08)] hover:text-[#F85149]"
                  type="button"
                  onClick={() => void handleCloudSignOut()}
                >
                  Sign out
                </button>
              ) : null}

              <button
                type="button"
                className="relative inline-flex h-9 w-9 items-center justify-center rounded-md border border-[rgba(56,63,72,1)] bg-[#1C2128] text-[#8B949E] transition-colors duration-150 hover:border-[rgba(86,93,102,1)] hover:bg-[#21262D] hover:text-[#E6EDF3]"
                onClick={() => openDrawer({ type: 'notification-centre' })}
                aria-label="Open notification centre"
              >
                <BellIcon className="h-[16px] w-[16px]" />
                {pendingReview + pendingTransfers ? (
                  <span className="absolute right-0.5 top-0.5 min-w-[16px] rounded-full bg-[#F85149] px-1 py-px text-center text-[9px] font-bold text-white">
                    {pendingReview + pendingTransfers}
                  </span>
                ) : null}
              </button>

              {canUploadDocuments ? (
                <Link
                  className="inline-flex h-9 items-center justify-center rounded-md border border-[rgba(56,63,72,1)] bg-[#1C2128] px-3 text-[13px] font-semibold text-[#C2CCD6] transition-colors duration-150 hover:border-[rgba(86,93,102,1)] hover:bg-[#21262D]"
                  to="/documents?upload=1"
                >
                  Upload
                </Link>
              ) : (
                <button
                  className="inline-flex h-9 cursor-not-allowed items-center justify-center rounded-md border border-[rgba(56,63,72,1)] bg-[#1C2128] px-3 text-[13px] font-semibold text-[#C2CCD6] opacity-40"
                  type="button"
                  disabled
                >
                  Upload
                </button>
              )}

              {canCreateHorse ? (
                <Link
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-md bg-[#2F8DFF] px-3 text-[13px] font-bold text-white transition-colors duration-150 hover:bg-[#388bfd]"
                  to="/horses?new=1"
                >
                  <AddIcon className="h-[14px] w-[14px]" />
                  New
                </Link>
              ) : (
                <button
                  className="inline-flex h-9 cursor-not-allowed items-center justify-center gap-1.5 rounded-md bg-[#2F8DFF] px-3 text-[13px] font-bold text-white opacity-40"
                  type="button"
                  disabled
                >
                  <AddIcon className="h-[14px] w-[14px]" />
                  New
                </button>
              )}
            </div>
          </div>
        </header>

        <main className="flex flex-col gap-5 px-5 py-5 pb-28 lg:pb-5">
          <Outlet />
        </main>

        {/* Mobile more menu */}
        {mobileMoreOpen ? (
          <>
            <button
              className="fixed inset-0 z-30 bg-[rgba(0,0,0,0.6)] lg:hidden"
              type="button"
              aria-label="Close mobile menu"
              onClick={() => setMobileMoreOpen(false)}
            />
            <div
              id="mobile-more-menu"
              className="fixed bottom-[94px] left-3 right-3 z-50 rounded-xl border border-[rgba(56,63,72,1)] bg-[#161B22] p-3 text-[#E6EDF3] shadow-2xl lg:hidden"
            >
              {canCreateHorse ? (
                <Link
                  className="mb-2 flex min-h-[48px] w-full items-center gap-3 rounded-lg bg-[#2F8DFF] px-3 text-left text-[13px] font-bold text-white"
                  to="/horses?new=1"
                  onClick={() => setMobileMoreOpen(false)}
                >
                  <AddIcon className="h-[16px] w-[16px] shrink-0" />
                  <span>New horse</span>
                </Link>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                {mobileMoreItems.map(({ label, path, icon: Icon }) => {
                  const isActive = path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);
                  return (
                    <Link
                      key={label}
                      className={classNames(
                        'flex min-h-[52px] items-center gap-2.5 rounded-lg border px-3 text-left text-[12px] font-semibold transition-colors duration-150',
                        isActive
                          ? 'border-[rgba(47,141,255,0.25)] bg-[rgba(47,141,255,0.1)] text-[#2F8DFF]'
                          : 'border-[rgba(48,54,61,0.9)] bg-[#1C2128] text-[#8B949E] hover:border-[rgba(56,63,72,1)] hover:text-[#C2CCD6]',
                      )}
                      to={path}
                      onClick={() => setMobileMoreOpen(false)}
                    >
                      <Icon className="h-[16px] w-[16px] shrink-0" />
                      <span className="min-w-0 truncate">{label}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}

        {/* Mobile bottom nav */}
        <nav
          className="fixed bottom-3 left-3 right-3 z-40 grid grid-cols-5 gap-1.5 rounded-xl border border-[rgba(56,63,72,1)] bg-[rgba(22,27,34,0.98)] p-2 shadow-2xl backdrop-blur lg:hidden"
          aria-label="Mobile quick navigation"
        >
          {([
            { label: 'Home', path: '/', icon: DashboardIcon, badge: pendingTransfers + careDueCount },
            { label: 'Horses', path: '/horses', icon: HorsesIcon, badge: 0 },
            { label: 'Docs', path: '/documents', icon: DocumentsIcon, badge: pendingReview },
            { label: 'Sales', path: '/sales', icon: SalesIcon, badge: 0 },
          ] as const).map(({ label, path, icon: Icon, badge }) => (
            <NavLink
              key={label}
              to={path}
              end={path === '/'}
              className={({ isActive }) =>
                classNames(
                  'relative flex min-h-[60px] flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-bold transition-colors duration-150',
                  isActive
                    ? 'bg-[rgba(47,141,255,0.12)] text-[#2F8DFF]'
                    : 'text-[#4a6275] hover:bg-[rgba(255,255,255,0.04)] hover:text-[#8B949E]',
                )
              }
            >
              <Icon className="h-[17px] w-[17px]" />
              <span>{label}</span>
              {badge > 0 ? (
                <span className="absolute right-1.5 top-1.5 min-w-[15px] rounded-full bg-[#F85149] px-1 py-px text-center text-[9px] font-bold text-white">
                  {badge}
                </span>
              ) : null}
            </NavLink>
          ))}
          <button
            className={classNames(
              'relative flex min-h-[60px] flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-bold transition-colors duration-150',
              mobileMoreOpen || mobileMoreItems.some((item) => location.pathname.startsWith(item.path) && item.path !== '/')
                ? 'bg-[rgba(47,141,255,0.12)] text-[#2F8DFF]'
                : 'text-[#4a6275] hover:bg-[rgba(255,255,255,0.04)] hover:text-[#8B949E]',
            )}
            type="button"
            onClick={() => setMobileMoreOpen((current) => !current)}
            aria-expanded={mobileMoreOpen}
            aria-controls="mobile-more-menu"
          >
            <DotsIcon className="h-[17px] w-[17px]" />
            <span>More</span>
            {pendingTransfers + careDueCount > 0 ? (
              <span className="absolute right-1.5 top-1.5 min-w-[15px] rounded-full bg-[#F85149] px-1 py-px text-center text-[9px] font-bold text-white">
                {pendingTransfers + careDueCount}
              </span>
            ) : null}
          </button>
        </nav>

        <WorkspaceHelp open={helpOpen} title={currentLabel} sections={helpSections} onClose={() => setHelpOpen(false)} />
      </div>

      {/* Global overlays — rendered at root of layout so they are above all content */}
      <RightDrawer />
      <CommandPalette />
    </div>
  );
}
