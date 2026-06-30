import type { ComponentType, KeyboardEvent, SVGProps } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { XbarMark } from '@/components/BrandMark';
import { CommercialPressureBanner } from '@/components/CommercialPressureBanner';
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

type NavSectionName = 'Home' | 'Work' | 'Account';

type NavItem = {
  label: string;
  path: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  section: NavSectionName;
  requires?: 'billing' | 'settings';
  badgeKey?: 'transfers' | 'care' | 'docs' | 'reminders';
};

const navItems: NavItem[] = [
  { label: 'Home', path: '/', icon: DashboardIcon, section: 'Home' },
  { label: 'Horses', path: '/horses', icon: HorsesIcon, section: 'Home' },
  { label: 'Ownership', path: '/ownership', icon: OwnershipIcon, section: 'Home', badgeKey: 'transfers' },
  { label: 'Documents', path: '/documents', icon: DocumentsIcon, section: 'Home', badgeKey: 'docs' },
  { label: 'Document Library', path: '/document-library', icon: DocumentsIcon, section: 'Home' },
  { label: 'Health', path: '/medical', icon: MedicalIcon, section: 'Work', badgeKey: 'care' },
  { label: 'Breeding', path: '/breeding', icon: BreedingIcon, section: 'Work' },
  { label: 'Sales', path: '/sales', icon: SalesIcon, section: 'Work' },
  { label: 'Expenses', path: '/expenses', icon: SubscriptionIcon, section: 'Work' },
  { label: 'Reminders', path: '/reminders', icon: BellIcon, section: 'Work', badgeKey: 'reminders' },
  { label: 'Equipment', path: '/assets', icon: AssetsIcon, section: 'Work' },
  { label: 'Weather', path: '/weather', icon: WeatherIcon, section: 'Work' },
  { label: 'Listings', path: '/shared-access', icon: SharedAccessIcon, section: 'Account' },
  { label: 'Plan & Billing', path: '/subscriptions', icon: SubscriptionIcon, section: 'Account', requires: 'billing' },
  { label: 'Settings', path: '/settings', icon: SettingsIcon, section: 'Account', requires: 'settings' },
];

const routeLabels: Record<string, string> = {
  '/': 'Home',
  '/horses': 'Horses',
  '/documents': 'Documents',
  '/document-library': 'Document Library',
  '/ownership': 'Ownership',
  '/medical': 'Health',
  '/breeding': 'Breeding',
  '/sales': 'Sales',
  '/expenses': 'Expenses',
  '/reminders': 'Reminders',
  '/assets': 'Equipment',
  '/weather': 'Weather',
  '/subscriptions': 'Plan & Billing',
  '/shared-access': 'Listings',
  '/settings': 'Settings',
};

const routeHelp: Record<string, HelpSection[]> = {
  'Home': [
    { label: 'Daily Work', text: 'Start with transfers, care holds, document review, buyer movement, or spending.' },
    { label: 'Records', text: 'Each section keeps status, documents, risk, and next action visible.' },
  ],
  'Horses': [
    { label: 'Horse file', text: 'Each horse should read like a horse record: identity, ownership, care, documents, sales, and history.' },
    { label: 'Confirmed data', text: 'Unknown should remain unknown until verified by a source record.' },
  ],
  'Ownership': [
    { label: 'Ownership', text: 'Use this area for owners, percentages, sale status, transfer blockers, and source documents.' },
    { label: 'Transfers', text: 'No sale or transfer should move without required documents resolved.' },
  ],
  'Documents': [
    { label: 'Documents', text: 'Upload first. Assign, approve, and keep the document chain clean.' },
    { label: 'Release discipline', text: 'Only approved ready-to-share files should reach buyer packets.' },
  ],
  'Document Library': [
    { label: 'Prefill', text: 'Templates pull horse, owner, barn, health, Coggins, sale, and document-vault data.' },
    { label: 'Export', text: 'Preview, download a report, print to PDF, or copy the buyer-facing link.' },
  ],
  'Health': [
    { label: 'Care holds', text: 'Coggins, vaccines, dental, wormer, treatment, and due dates belong here.' },
    { label: 'Source dates', text: 'Do not guess due dates. Use records the operation can verify.' },
  ],
  'Breeding': [
    { label: 'Program', text: 'Track pairings, milestones, contracts, foaling windows, and documents.' },
    { label: 'Decisions', text: 'Breeding movement should connect back to files and history.' },
  ],
  'Sales': [
    { label: 'Pipeline', text: 'Keep lead movement, buyer quality, record readiness, and follow-ups visible.' },
    { label: 'Buyer packet', text: 'Share only when the horse and documents are ready.' },
  ],
  'Expenses': [
    { label: 'Ledger', text: 'Log costs while the context is fresh.' },
    { label: 'Connect', text: 'Receipts should connect to horses, care, documents, and operating decisions.' },
  ],
  'Reminders': [
    { label: 'Queue', text: 'This is the work list for care, papers, documents, transfers, and buyer movement.' },
    { label: 'Confidence', text: 'An action should always show the source of the work.' },
  ],
  'Equipment': [
    { label: 'Assets', text: 'Track equipment, kits, feed supply, transport, and service work.' },
    { label: 'Field use', text: 'Keep mobile actions short and readable.' },
  ],
  'Weather': [
    { label: 'Conditions', text: 'Use weather for turnout, hauling, handling, breeding, and field work.' },
    { label: 'Location', text: 'Set the ranch location in Settings for better daily context.' },
  ],
  'Plan & Billing': [
    { label: 'Plan state', text: 'Keep plan status clear without implying cloud billing is connected before it is.' },
    { label: 'Limits', text: 'Storage, seats, listings, and documents should remain easy to understand.' },
  ],
  'Listings': [
    { label: 'Release', text: 'Buyer links need approved, sanitized records only.' },
    { label: 'Review', text: 'Preview before making any horse public.' },
  ],
  'Settings': [
    { label: 'Control', text: 'Manage ranch defaults, members, sync, and backups.' },
    { label: 'Recovery', text: 'Use backups before large imports or cloud changes.' },
  ],
  'Horse': [
    { label: 'Horse record', text: 'Identity, care, ownership, documents, sales, and history should read as one record.' },
    { label: 'Missing data', text: 'Unknown should stay unknown until verified.' },
  ],
};

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

const sectionDisplayNames: Record<NavSectionName, string> = {
  Home: 'Home',
  Work: 'Daily Work',
  Account: 'Account',
};

function routeSurfaceSlug(label: string) {
  return label
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'home';
}

function ShellHorseMotif({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 620 310" fill="none" aria-hidden="true">
      <path d="M30 211c54-43 115-65 181-65 36 0 64 10 93 28 25 16 50 23 83 19 53-6 90-30 128-66 21-19 43-35 70-40 14-3 26 1 32 12 7 13-2 30-22 40-22 11-45 19-67 27-18 6-33 15-46 28-20 20-41 39-70 50-44 17-94 11-137-4-40-14-77-15-119-5-47 11-87 8-126-24Z" />
      <path d="M205 146c12-36 36-62 71-76 37-15 82-10 117 12 27 17 47 44 68 70" />
      <path d="M282 76c-11-25-7-48 10-62 20 25 23 49 9 69" />
      <path d="M360 77c11-22 29-34 54-32-1 28-16 46-45 51" />
      <path d="M136 219c-16 18-27 40-33 64" />
      <path d="M235 237c-8 21-12 41-12 60" />
      <path d="M427 239c6 21 18 39 35 55" />
      <path d="M504 205c23 20 38 44 44 75" />
    </svg>
  );
}

function NavSection({ title, items, badges }: { title: NavSectionName; items: NavItem[]; badges: Record<string, number> }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="px-3 font-[Geist] text-[10px] font-semibold uppercase tracking-[0.24em] text-[#596168]">{sectionDisplayNames[title]}</div>
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
                    ? 'border-[#0B0D0F] bg-[#F5F2EC] font-semibold text-[#121518]'
                    : 'border-transparent text-[#596168] hover:border-[#B7BCC2] hover:bg-[#F5F2EC] hover:text-[#121518]',
                )
              }
            >
              <Icon className="h-[17px] w-[17px] shrink-0" />
              <span className="flex-1">{label}</span>
              {badge > 0 ? <span className={classNames('nav-badge', badge <= 3 ? 'nav-badge--blue' : '')}>{badge}</span> : null}
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
  const setCommandPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);
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
    Home: visibleNavItems.filter((item) => item.section === 'Home'),
    Work: visibleNavItems.filter((item) => item.section === 'Work'),
    Account: visibleNavItems.filter((item) => item.section === 'Account'),
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
  const commandState = opsUrgency === 'urgent' ? 'Action required' : opsUrgency === 'warning' ? 'Needs review' : 'All clear';
  const localStatus = cloudStatus === 'signed-in' ? 'Cloud sync connected' : 'Local browser workspace';
  const currentLabel = location.pathname.startsWith('/horses/') ? 'Horse' : routeLabels[location.pathname] ?? 'Ranch';
  const routeSlug = routeSurfaceSlug(currentLabel);
  const helpSections = routeHelp[currentLabel] ?? routeHelp['Home'];
  const accountLabel = cloudSession?.user?.email ?? currentRole;

  useEffect(() => { setHelpOpen(false); setMobileMoreOpen(false); }, [location.pathname]);

  const handleSearch = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && search.trim()) navigate(`/horses?search=${encodeURIComponent(search.trim())}`);
  };

  const handleCloudSignOut = async () => {
    const result = await signOutCloud();
    pushToast({ title: result.ok ? 'Signed out' : 'Sign-out failed', message: result.message, tone: result.ok ? 'success' : 'error' });
    if (result.ok) navigate('/login', { replace: true });
  };

  return (
    <div className={classNames('xbar-command-shell min-h-screen lg:grid lg:grid-cols-[264px,1fr]', `xbar-shell-${routeSlug}`)}>
      <aside className="hidden min-h-screen flex-col gap-6 border-r border-[#B7BCC2] bg-[#F5F2EC] px-5 py-6 text-[#121518] lg:flex">
        <div className="xbar-sidebar-brand flex items-center gap-3">
          <div className="xbar-sidebar-brand__mark flex h-[52px] w-[52px] items-center justify-center rounded-lg border border-[#B7BCC2] bg-white p-1.5 shadow-[0_8px_22px_rgba(11,13,15,0.08)]">
            <XbarMark title="XBAR logo" className="h-full w-full" />
          </div>
          <div className="xbar-sidebar-brand__copy min-w-0">
            <div className="text-[1.04rem] font-extrabold uppercase tracking-[0.14em] text-[#0B0D0F]">XBAR</div>
            <div className="font-[Geist] text-[10px] font-semibold uppercase tracking-[0.24em] text-[#596168]">Horse records</div>
          </div>
        </div>

        <div className="rounded-lg border border-[#B7BCC2] bg-white p-4 shadow-[0_8px_24px_rgba(11,13,15,0.04)]">
          <div className="flex items-center justify-between gap-2">
            <div className="font-[Geist] text-[10px] font-semibold uppercase tracking-[0.24em] text-[#596168]">Ranch Status</div>
            <span className="ops-pulse">
              <span className={classNames('ops-pulse__dot', opsUrgency === 'urgent' ? 'ops-pulse__dot--urgent' : opsUrgency === 'warning' ? 'ops-pulse__dot--warning' : '')} />
            </span>
          </div>
          <div className="mt-2 text-[0.96rem] font-bold leading-tight text-[#121518]">{workspaceProfile.ranchName || workspaceProfile.businessName || 'Primary ranch'}</div>
          <div className="mt-0.5 text-xs text-[#596168]">{commandState} · {roleWorkspace.label}</div>
          <div className="mt-3 grid grid-cols-2 gap-1.5 text-xs">
            <span className="rounded border border-[#B7BCC2] bg-[#F5F2EC] px-2 py-1.5 text-[#596168]">{horses.length} files</span>
            <span className={classNames('rounded border px-2 py-1.5', pendingTransfers > 0 ? 'border-[#0078D7] bg-[#F5F2EC] text-[#0B0D0F]' : 'border-[#B7BCC2] bg-[#F5F2EC] text-[#596168]')}>{pendingTransfers} transfers</span>
            <span className={classNames('rounded border px-2 py-1.5', pendingReview > 0 ? 'border-[#C7BDAA] bg-[#F5F2EC] text-[#20252A]' : 'border-[#B7BCC2] bg-[#F5F2EC] text-[#596168]')}>{pendingReview} docs</span>
            <span className="rounded border border-[#B7BCC2] bg-[#F5F2EC] px-2 py-1.5 text-[#596168]">{activeSales} buyers</span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <span className="inline-flex min-h-[24px] items-center rounded-full border border-[#B7BCC2] bg-[#F5F2EC] px-2.5 py-0.5 font-[Geist] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#596168]">{subscription.tier}</span>
            <span className="inline-flex min-h-[24px] items-center rounded-full border border-[#0B0D0F] bg-[#0B0D0F] px-2.5 py-0.5 font-[Geist] text-[10px] font-semibold uppercase tracking-[0.12em] text-white">{localStatus}</span>
          </div>
        </div>

        <NavSection title="Home" items={sections.Home} badges={navBadges} />
        <NavSection title="Work" items={sections.Work} badges={navBadges} />
        <NavSection title="Account" items={sections.Account} badges={navBadges} />

        <div className="mt-auto border-t border-[#B7BCC2] pt-4 text-xs text-[#596168]">
          <div className="font-[Geist] font-semibold uppercase tracking-[0.12em] text-[#596168]">Workspace</div>
          <div className="mt-1 text-[#596168]">{expenseReceipts.length} receipts · {documents.length} documents · {horses.length} horse records</div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="xbar-command-topbar sticky top-0 z-10 border-b border-[#B7BCC2] bg-[#F5F2EC]/85 backdrop-blur">
          <div className="flex min-h-[62px] flex-wrap items-center justify-between gap-4 px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="text-[0.98rem] font-extrabold tracking-[0.01em] text-[#121518]">{currentLabel}</div>
              <span className={classNames('inline-flex min-h-[24px] items-center rounded-md border px-2.5 py-1 font-[Geist] text-[11px] font-semibold uppercase tracking-[0.14em]', pendingReview || pendingTransfers ? 'border-[#C7BDAA] bg-[#F5F2EC] text-[#20252A]' : 'border-[#B7BCC2] bg-[#F5F2EC] text-[#596168]')}>
                {pendingReview || pendingTransfers ? `${pendingReview + pendingTransfers} open` : 'All clear'}
              </span>
            </div>

            <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
              <label className="relative min-w-[220px] max-w-[420px] flex-1">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#596168]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={handleSearch}
                  onFocus={() => setCommandPaletteOpen(true)}
                  placeholder="Search horses, documents, buyers, or tasks"
                  aria-label="Open XBAR search"
                  className="h-10 w-full rounded-md border border-[#B7BCC2] bg-white pl-10 pr-4 text-sm text-[#121518] transition-all duration-150 ease-[ease] placeholder:text-[#596168] focus:border-[#0078D7] focus:outline-none"
                />
                <kbd className="command-shortcut-hint">Ctrl K</kbd>
              </label>

              <div className="hidden h-10 items-center gap-3 rounded-md border border-[#B7BCC2] bg-white px-3 text-sm font-semibold text-[#121518] md:inline-flex">
                <span className="max-w-[190px] truncate">{accountLabel}</span>
                <span className="inline-flex rounded-sm border border-[#B7BCC2] bg-[#F5F2EC] px-2 py-0.5 font-[Geist] text-[10px] font-semibold uppercase tracking-[0.14em] text-[#596168]">{cloudSession ? currentRole : 'Local'}</span>
              </div>

              <button className="inline-flex h-10 items-center justify-center rounded-md border border-[#B7BCC2] bg-white px-4 text-sm font-semibold text-[#121518] transition-all duration-150 ease-[ease] hover:border-[#0B0D0F] hover:bg-[#F5F2EC]" type="button" onClick={() => setHelpOpen(true)}>
                Help
              </button>

              {cloudSession && canSyncCloud ? (
                <button className="inline-flex h-10 items-center justify-center rounded-md border border-[#B7BCC2] bg-white px-4 text-sm font-semibold text-[#121518] transition-all duration-150 ease-[ease] hover:border-[#0B0D0F] hover:bg-[#F5F2EC]" type="button" onClick={() => void handleCloudSignOut()}>
                  Sign out
                </button>
              ) : null}

              <button className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#B7BCC2] bg-white text-[#121518] transition-all duration-150 ease-[ease] hover:border-[#0B0D0F] hover:bg-[#F5F2EC]" type="button" onClick={() => navigate('/reminders')} aria-label="Open reminders">
                <BellIcon className="h-[18px] w-[18px]" />
                {pendingReview + pendingTransfers ? <span className="absolute right-0.5 top-0.5 min-w-[18px] rounded-full bg-[#0078D7] px-1.5 py-0.5 text-[10px] font-bold text-white">{pendingReview + pendingTransfers}</span> : null}
              </button>

              <button className="inline-flex h-10 items-center justify-center rounded-md border border-[#B7BCC2] bg-white px-4 text-sm font-semibold text-[#121518] transition-all duration-150 ease-[ease] hover:border-[#0B0D0F] hover:bg-[#F5F2EC] disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={() => navigate('/documents?upload=1')} disabled={!canUploadDocuments}>
                Upload Documents
              </button>

              <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#0B0D0F] px-4 text-sm font-semibold text-white shadow-sm transition-all duration-150 ease-[ease] hover:bg-[#20252A] disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={() => navigate('/horses?new=1')} disabled={!canCreateHorse}>
                <AddIcon className="h-[16px] w-[16px]" />
                Add Horse
              </button>
            </div>
          </div>
        </header>

        <main
          className={classNames(
            'xbar-command-main xbar-route-surface flex flex-col gap-[20px] px-6 py-5 pb-28 lg:pb-5',
            `xbar-route-${routeSlug}`,
          )}
          data-route={routeSlug}
        >
          <div className="xbar-shell-motifs" aria-hidden="true">
            <span className="xbar-shell-x xbar-shell-x--one" />
            <span className="xbar-shell-x xbar-shell-x--two" />
            <ShellHorseMotif className="xbar-shell-horse-line" />
          </div>
          <section className="xbar-context-strip" aria-label="Workspace overview">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="xbar-context-strip__crumbs">
                <span>XBAR</span>
                <span data-sep>/</span>
                <strong>{currentLabel}</strong>
              </div>
              <div className="xbar-context-strip__title">{workspaceProfile.ranchName || workspaceProfile.businessName || 'Your ranch'}</div>
            </div>
            <div className="xbar-context-strip__meta" aria-label="Workspace totals">
              <span className="xbar-context-chip">Horses <strong>{horses.length}</strong></span>
              <span className="xbar-context-chip">Documents <strong>{documents.length}</strong></span>
              <span
                className={classNames(
                  'xbar-context-chip',
                  pendingReview + pendingTransfers + careDueCount > 0 ? 'xbar-context-chip--alert' : 'xbar-context-chip--ok',
                )}
              >
                {pendingReview + pendingTransfers + careDueCount > 0 ? 'Open work' : 'All clear'}
                <strong>{pendingReview + pendingTransfers + careDueCount}</strong>
              </span>
              <span className="xbar-context-chip">{subscription.tier}</span>
            </div>
          </section>
          <CommercialPressureBanner />
          <div className="xbar-route-transition" key={location.pathname}>
            <Outlet />
          </div>
        </main>

        {mobileMoreOpen ? (
          <>
            <button className="fixed inset-0 z-30 bg-[#121518]/40 lg:hidden" type="button" aria-label="Close mobile menu" onClick={() => setMobileMoreOpen(false)} />
            <div id="mobile-more-menu" className="fixed bottom-[94px] left-3 right-3 z-50 rounded-lg border border-[#B7BCC2] bg-white p-3 text-[#121518] shadow-xl lg:hidden">
              {canCreateHorse ? (
                <button className="mb-2 flex min-h-[50px] w-full items-center gap-3 rounded-md bg-[#0B0D0F] px-3 text-left text-sm font-semibold text-white" type="button" onClick={() => { setMobileMoreOpen(false); navigate('/horses?new=1'); }}>
                  <AddIcon className="h-[18px] w-[18px] shrink-0" />
                  <span>Add horse</span>
                </button>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                {mobileMoreItems.map(({ label, path, icon: Icon }) => {
                  const isActive = path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);
                  return (
                    <button key={label} className={classNames('flex min-h-[54px] items-center gap-3 rounded-md border px-3 text-left text-sm font-semibold transition-all duration-150 ease-[ease]', isActive ? 'border-[#0B0D0F] bg-[#F5F2EC] text-[#121518]' : 'border-[#B7BCC2] bg-white text-[#596168] hover:border-[#0B0D0F] hover:bg-[#F5F2EC]')} type="button" onClick={() => { setMobileMoreOpen(false); navigate(path); }}>
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      <span className="min-w-0 truncate">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}

        <nav className="fixed bottom-3 left-3 right-3 z-40 grid grid-cols-5 gap-2 rounded-lg border border-[#B7BCC2] bg-white p-2 text-[#121518] shadow-lg lg:hidden" aria-label="Mobile quick navigation">
          {([
            { label: 'Home', path: '/', icon: DashboardIcon, badge: pendingTransfers + careDueCount },
            { label: 'Horses', path: '/horses', icon: HorsesIcon, badge: 0 },
            { label: 'Documents', path: '/documents', icon: DocumentsIcon, badge: pendingReview },
            { label: 'Sales', path: '/sales', icon: SalesIcon, badge: 0 },
          ] as const).map(({ label, path, icon: Icon, badge }) => (
            <NavLink key={label} to={path} end={path === '/'} className={({ isActive }) => classNames('relative flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-md text-[11px] font-semibold transition-all duration-150 ease-[ease]', isActive ? 'bg-[#F5F2EC] text-[#121518]' : 'text-[#596168] hover:bg-[#F5F2EC] hover:text-[#121518]')}>
              <Icon className="h-[18px] w-[18px]" />
              <span>{label}</span>
              {badge > 0 ? <span className="absolute right-2 top-2 min-w-[16px] rounded-full bg-[#0078D7] px-1 py-px text-center text-[9px] font-bold text-white">{badge}</span> : null}
            </NavLink>
          ))}
          <button className={classNames('relative flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-md text-[11px] font-semibold transition-all duration-150 ease-[ease]', mobileMoreOpen || mobileMoreItems.some((item) => location.pathname.startsWith(item.path) && item.path !== '/') ? 'bg-[#F5F2EC] text-[#121518]' : 'text-[#596168] hover:bg-[#F5F2EC] hover:text-[#121518]')} type="button" onClick={() => setMobileMoreOpen((current) => !current)} aria-expanded={mobileMoreOpen} aria-controls="mobile-more-menu">
            <DotsIcon className="h-[18px] w-[18px]" />
            <span>More</span>
            {pendingTransfers + careDueCount > 0 ? <span className="absolute right-2 top-2 min-w-[16px] rounded-full bg-[#0078D7] px-1 py-px text-center text-[9px] font-bold text-white">{pendingTransfers + careDueCount}</span> : null}
          </button>
        </nav>
      </div>

      <WorkspaceHelp open={helpOpen} title={currentLabel} sections={helpSections} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
