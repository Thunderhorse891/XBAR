import type { ComponentType, KeyboardEvent, SVGProps } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { XbarMark } from '@/components/BrandMark';
import { WorkspaceHelp, type HelpSection } from '@/components/WorkspaceHelp';
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
    <div className="flex flex-col gap-2">
      <div className="px-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#3d5870]">{title}</div>
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
                  'group flex items-center gap-3 border-l-[3px] px-3 py-[9px] text-[13px] font-medium transition-all duration-150 ease-[ease]',
                  isActive
                    ? 'border-[#4d94ff] bg-[#0d2040] text-white shadow-[0_6px_18px_rgba(34,102,238,0.2)]'
                    : 'border-transparent text-[#7a9ab4] hover:border-[#1e3a56] hover:bg-[#0b1c30] hover:text-[#c8ddf0]',
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
  const [search, setSearch] = useState('');
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

  useEffect(() => {
    setHelpOpen(false);
    setMobileMoreOpen(false);
  }, [location.pathname]);

  const handleSearch = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && search.trim()) {
      navigate(`/horses?search=${encodeURIComponent(search.trim())}`);
    }
  };

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
    <div className="min-h-screen bg-[#eef3f8] lg:grid lg:grid-cols-[254px,1fr]">
      <aside className="hidden min-h-screen flex-col gap-6 border-r border-[#0e1e32] bg-[#050b14] px-5 py-6 text-[#c2d4e8] lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-[52px] w-[52px] items-center justify-center rounded-lg border border-[#1a2e46] bg-[#050910] p-1.5 shadow-[0_14px_32px_rgba(47,141,255,0.18)]">
            <XbarMark title="XBAR logo" className="h-full w-full" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[1.04rem] font-extrabold uppercase tracking-[0.14em] text-white">{workspaceProfile.businessName || 'XBAR'}</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#52708d]">Horse Management. Reimagined.</div>
          </div>
        </div>

        <div className="rounded-[14px] border border-[#162436] bg-[#080f1c] p-4 shadow-[0_12px_28px_rgba(0,0,0,0.36)]">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#3d5870]">Ranch</div>
            <span className={classNames('ops-pulse', opsUrgency !== 'clear' ? '' : '')}>
              <span className={classNames('ops-pulse__dot', opsUrgency === 'urgent' ? 'ops-pulse__dot--urgent' : opsUrgency === 'warning' ? 'ops-pulse__dot--warning' : '')} />
            </span>
          </div>
          <div className="mt-2 text-[0.96rem] font-bold leading-tight text-[#ddeaf8]">{workspaceProfile.ranchName || workspaceProfile.businessName || 'Primary ranch'}</div>
          <div className="mt-0.5 text-xs text-[#526d85]">{roleWorkspace.label}</div>
          <div className="mt-3 grid grid-cols-2 gap-1.5 text-xs">
            <span className="rounded border border-[#142030] bg-[#08111d] px-2 py-1.5 text-[#6e8da6]">{horses.length} horses</span>
            <span className={classNames(
              'rounded border px-2 py-1.5',
              pendingTransfers > 0
                ? 'border-[#5a1a1a] bg-[#1a0808] text-[#ff8a8a]'
                : 'border-[#142030] bg-[#08111d] text-[#6e8da6]',
            )}>{pendingTransfers} transfers</span>
            <span className={classNames(
              'rounded border px-2 py-1.5',
              pendingReview > 0
                ? 'border-[#4a3800] bg-[#191000] text-[#fbbf24]'
                : 'border-[#142030] bg-[#08111d] text-[#6e8da6]',
            )}>{pendingReview} docs</span>
            <span className="rounded border border-[#142030] bg-[#08111d] px-2 py-1.5 text-[#6e8da6]">{activeSales} buyers</span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <span className="inline-flex min-h-[24px] items-center rounded-full border border-[#1a2e46] bg-[#0a1628] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#5a7a94]">{subscription.tier}</span>
            <span className="inline-flex min-h-[24px] items-center rounded-full border border-[#1a3a6a] bg-[#0c1e3c] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#4d88cc]">{cloudStatus === 'signed-in' ? 'Cloud sync' : 'Browser'}</span>
          </div>
        </div>

        <NavSection title="Command" items={sections.Command} badges={navBadges} />
        <NavSection title="Operations" items={sections.Operations} badges={navBadges} />
        <NavSection title="Platform" items={sections.Platform} badges={navBadges} />

        <div className="mt-auto border-t border-[#0a1624] pt-4 text-xs text-[#3d5870]">
          <div className="font-semibold uppercase tracking-[0.12em] text-[#4a6880]">Horse Management. Reimagined.</div>
          <div className="mt-1 text-[#2e4560]">{expenseReceipts.length} receipts · {documents.length} files · {horses.length} horses</div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col bg-[#eef3f8]">
        <header className="sticky top-0 z-10 border-b border-[#d7e0ea] bg-[#fbfdff]/90 backdrop-blur">
          <div className="flex min-h-[58px] flex-wrap items-center justify-between gap-4 px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="text-[0.96rem] font-extrabold tracking-[0.01em] text-[#16202b]">{currentLabel}</div>
              <span className={classNames('inline-flex min-h-[24px] items-center rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]', pendingReview || pendingTransfers ? 'border-[#dbe4ed] bg-[#f4f8fb] text-[#627181]' : 'border-[#d7e8ef] bg-[#eaeffd] text-[#1155dd]')}>
                {pendingReview || pendingTransfers ? `${pendingReview + pendingTransfers} open` : 'Ready'}
              </span>
            </div>

            <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
              <label className="relative min-w-[220px] max-w-[420px] flex-1">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#7d8389]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={handleSearch}
                  placeholder="Search horses"
                  className="h-10 w-full rounded-md border border-[#dde5ee] bg-white pl-10 pr-4 text-sm text-[#16202b] transition-all duration-150 ease-[ease] placeholder:text-[#8f959c] focus:border-[#1155dd] focus:outline-none"
                />
              </label>

              <div className="hidden h-10 items-center gap-3 rounded-md border border-[#dde5ee] bg-white px-3 text-sm font-semibold text-[#16202b] md:inline-flex">
                <span className="max-w-[190px] truncate">{accountLabel}</span>
                <span className="inline-flex rounded-sm border border-[#d8e1ea] bg-[#eef3f8] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#607384]">{cloudSession ? currentRole : 'Browser'}</span>
              </div>

              <button className="inline-flex h-10 items-center justify-center rounded-md border border-[#dde5ee] bg-white px-4 text-sm font-semibold text-[#16202b] transition-all duration-150 ease-[ease] hover:border-[#1155dd] hover:bg-[#eef6fb]" type="button" onClick={() => setHelpOpen(true)}>
                Help
              </button>

              {cloudSession && canSyncCloud ? (
                <button className="inline-flex h-10 items-center justify-center rounded-md border border-[#dde5ee] bg-white px-4 text-sm font-semibold text-[#16202b] transition-all duration-150 ease-[ease] hover:border-[#1155dd] hover:bg-[#eef6fb]" type="button" onClick={() => void handleCloudSignOut()}>
                  Sign out
                </button>
              ) : null}

              <button className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#dde5ee] bg-white text-[#16202b] transition-all duration-150 ease-[ease] hover:border-[#1155dd] hover:bg-[#eef6fb]" type="button" onClick={() => navigate('/reminders')} aria-label="Open reminders">
                <BellIcon className="h-[18px] w-[18px]" />
                {pendingReview + pendingTransfers ? <span className="absolute right-0.5 top-0.5 min-w-[18px] rounded-full bg-[#CC3333] px-1.5 py-0.5 text-[10px] font-bold text-white">{pendingReview + pendingTransfers}</span> : null}
              </button>

              <button className="inline-flex h-10 items-center justify-center rounded-md border border-[#dde5ee] bg-white px-4 text-sm font-semibold text-[#16202b] transition-all duration-150 ease-[ease] hover:border-[#1155dd] hover:bg-[#eef6fb] disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={() => navigate('/documents?upload=1')} disabled={!canUploadDocuments}>
                Upload
              </button>

              <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#1155dd] px-4 text-sm font-semibold text-white shadow-sm transition-all duration-150 ease-[ease] hover:bg-[#0d44b0] disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={() => navigate('/horses?new=1')} disabled={!canCreateHorse}>
                <AddIcon className="h-[16px] w-[16px]" />
                New
              </button>
            </div>
          </div>
        </header>

        <main className="flex flex-col gap-[20px] px-6 py-5 pb-28 lg:pb-5">
          <Outlet />
        </main>

        {mobileMoreOpen ? (
          <>
            <button className="fixed inset-0 z-30 bg-[#061426]/30 lg:hidden" type="button" aria-label="Close mobile menu" onClick={() => setMobileMoreOpen(false)} />
            <div id="mobile-more-menu" className="fixed bottom-[94px] left-3 right-3 z-50 rounded-lg border border-[#d8e1ea] bg-[#fbfdff] p-3 text-[#16202b] shadow-xl lg:hidden">
              {canCreateHorse ? (
                <button className="mb-2 flex min-h-[50px] w-full items-center gap-3 rounded-md bg-[#1155dd] px-3 text-left text-sm font-semibold text-white" type="button" onClick={() => { setMobileMoreOpen(false); navigate('/horses?new=1'); }}>
                  <AddIcon className="h-[18px] w-[18px] shrink-0" />
                  <span>New horse</span>
                </button>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                {mobileMoreItems.map(({ label, path, icon: Icon }) => {
                  const isActive = path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);
                  return (
                    <button key={label} className={classNames('flex min-h-[54px] items-center gap-3 rounded-md border px-3 text-left text-sm font-semibold transition-all duration-150 ease-[ease]', isActive ? 'border-[#c8d7ff] bg-[#eaeffd] text-[#1155dd]' : 'border-[#e3e9f0] bg-white text-[#33475c] hover:border-[#1155dd] hover:bg-[#eef6fb]')} type="button" onClick={() => { setMobileMoreOpen(false); navigate(path); }}>
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      <span className="min-w-0 truncate">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}

        <nav className="fixed bottom-3 left-3 right-3 z-40 grid grid-cols-5 gap-2 rounded-lg border border-[#dde5ee] bg-[#fbfdff] p-2 text-[#16202b] shadow-lg lg:hidden" aria-label="Mobile quick navigation">
          {([
            { label: 'Home', path: '/', icon: DashboardIcon, badge: pendingTransfers + careDueCount },
            { label: 'Horses', path: '/horses', icon: HorsesIcon, badge: 0 },
            { label: 'Docs', path: '/documents', icon: DocumentsIcon, badge: pendingReview },
            { label: 'Sales', path: '/sales', icon: SalesIcon, badge: 0 },
          ] as const).map(({ label, path, icon: Icon, badge }) => (
            <NavLink key={label} to={path} end={path === '/'} className={({ isActive }) => classNames('relative flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-md text-[11px] font-semibold transition-all duration-150 ease-[ease]', isActive ? 'bg-[#eaeffd] text-[#1155dd]' : 'text-[#798088] hover:bg-white hover:text-[#16202b]')}>
              <Icon className="h-[18px] w-[18px]" />
              <span>{label}</span>
              {badge > 0 ? <span className="absolute right-2 top-2 min-w-[16px] rounded-full bg-[#CC3333] px-1 py-px text-center text-[9px] font-bold text-white">{badge}</span> : null}
            </NavLink>
          ))}
          <button className={classNames('relative flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-md text-[11px] font-semibold transition-all duration-150 ease-[ease]', mobileMoreOpen || mobileMoreItems.some((item) => location.pathname.startsWith(item.path) && item.path !== '/') ? 'bg-[#eaeffd] text-[#1155dd]' : 'text-[#798088] hover:bg-white hover:text-[#16202b]')} type="button" onClick={() => setMobileMoreOpen((current) => !current)} aria-expanded={mobileMoreOpen} aria-controls="mobile-more-menu">
            <DotsIcon className="h-[18px] w-[18px]" />
            <span>More</span>
            {pendingTransfers + careDueCount > 0 ? <span className="absolute right-2 top-2 min-w-[16px] rounded-full bg-[#CC3333] px-1 py-px text-center text-[9px] font-bold text-white">{pendingTransfers + careDueCount}</span> : null}
          </button>
        </nav>

        <WorkspaceHelp open={helpOpen} title={currentLabel} sections={helpSections} onClose={() => setHelpOpen(false)} />
      </div>
    </div>
  );
}
