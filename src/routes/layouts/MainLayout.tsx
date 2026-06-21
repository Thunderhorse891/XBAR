import type { ComponentType, KeyboardEvent, SVGProps } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { XbarMark } from '@/components/BrandMark';
import { CommercialPressureBanner } from '@/components/CommercialPressureBanner';
import { WorkspaceHelp, type HelpSection } from '@/components/WorkspaceHelp';
import { XbarIntelligenceRail } from '@/components/XbarIntelligenceRail';
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

type NavSectionName = 'Command' | 'Operations' | 'Control';

type NavItem = {
  label: string;
  path: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  section: NavSectionName;
  requires?: 'billing' | 'settings';
  badgeKey?: 'transfers' | 'care' | 'docs' | 'reminders';
};

const navItems: NavItem[] = [
  { label: 'Home', path: '/', icon: DashboardIcon, section: 'Command' },
  { label: 'My Horses', path: '/horses', icon: HorsesIcon, section: 'Command' },
  { label: 'Ownership', path: '/ownership', icon: OwnershipIcon, section: 'Command', badgeKey: 'transfers' },
  { label: 'Documents', path: '/documents', icon: DocumentsIcon, section: 'Command', badgeKey: 'docs' },
  { label: 'Document Library', path: '/document-library', icon: DocumentsIcon, section: 'Command' },
  { label: 'Health', path: '/medical', icon: MedicalIcon, section: 'Operations', badgeKey: 'care' },
  { label: 'Breeding', path: '/breeding', icon: BreedingIcon, section: 'Operations' },
  { label: 'Sales', path: '/sales', icon: SalesIcon, section: 'Operations' },
  { label: 'Expenses', path: '/expenses', icon: SubscriptionIcon, section: 'Operations' },
  { label: 'Reminders', path: '/reminders', icon: BellIcon, section: 'Operations', badgeKey: 'reminders' },
  { label: 'Equipment', path: '/assets', icon: AssetsIcon, section: 'Operations' },
  { label: 'Weather', path: '/weather', icon: WeatherIcon, section: 'Operations' },
  { label: 'Listings', path: '/shared-access', icon: SharedAccessIcon, section: 'Control' },
  { label: 'Plan & Billing', path: '/subscriptions', icon: SubscriptionIcon, section: 'Control', requires: 'billing' },
  { label: 'Settings', path: '/settings', icon: SettingsIcon, section: 'Control', requires: 'settings' },
];

const routeLabels: Record<string, string> = {
  '/': 'Home',
  '/horses': 'My Horses',
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
    { label: 'Daily brief', text: 'Start with the highest-risk decision: transfer proof, care holds, document review, buyer movement, or spending.' },
    { label: 'Command shape', text: 'Every section should answer entity, status, evidence, risk, and next action.' },
  ],
  'My Horses': [
    { label: 'Horse file', text: 'Each horse should read like a horse record: identity, ownership, care, documents, sales, and history.' },
    { label: 'Confirmed data', text: 'Unknown should remain unknown until verified by a source record.' },
  ],
  'Ownership': [
    { label: 'Proof chain', text: 'Use this area for owners, percentages, sale status, transfer blockers, and source documents.' },
    { label: 'Control', text: 'No sale or transfer should move without visible proof gaps resolved.' },
  ],
  'Documents': [
    { label: 'Vault', text: 'Upload first. Assign, approve, and keep the document chain clean.' },
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
    { label: 'Program', text: 'Track pairings, milestones, contracts, foaling windows, and proof.' },
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
    { label: 'Proof', text: 'Preview before making any horse public.' },
  ],
  'Settings': [
    { label: 'Control', text: 'Manage ranch defaults, members, sync, and backups.' },
    { label: 'Recovery', text: 'Use backups before large imports or cloud changes.' },
  ],
  'Horse Command File': [
    { label: 'Horse record', text: 'Identity, care, ownership, documents, sales, and history should read as one record.' },
    { label: 'Missing data', text: 'Unknown should stay unknown until verified.' },
  ],
};

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

const sectionDisplayNames: Record<NavSectionName, string> = {
  Command: 'My Barn',
  Operations: 'Daily Work',
  Control: 'Account',
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
      <div className="px-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#536d88]">{sectionDisplayNames[title]}</div>
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
    Command: visibleNavItems.filter((item) => item.section === 'Command'),
    Operations: visibleNavItems.filter((item) => item.section === 'Operations'),
    Control: visibleNavItems.filter((item) => item.section === 'Control'),
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
  const commandState = opsUrgency === 'urgent' ? 'Action required' : opsUrgency === 'warning' ? 'Watch active' : 'Command clear';
  const localStatus = cloudStatus === 'signed-in' ? 'Cloud sync connected' : 'Local browser workspace';
  const currentLabel = location.pathname.startsWith('/horses/') ? 'Horse Command File' : routeLabels[location.pathname] ?? 'Ranch';
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
    <div className="xbar-command-shell min-h-screen lg:grid lg:grid-cols-[264px,1fr]">
      <aside className="hidden min-h-screen flex-col gap-6 border-r border-[#0e1e32] bg-[#050b14] px-5 py-6 text-[#c2d4e8] lg:flex">
        <div className="xbar-sidebar-brand flex items-center gap-3">
          <div className="xbar-sidebar-brand__mark flex h-[52px] w-[52px] items-center justify-center rounded-lg border border-[#1a2e46] bg-[#050910] p-1.5 shadow-[0_14px_32px_rgba(47,141,255,0.18)]">
            <XbarMark title="XBAR logo" tone="mono" className="h-full w-full" />
          </div>
          <div className="xbar-sidebar-brand__copy min-w-0">
            <div className="text-[1.04rem] font-extrabold uppercase tracking-[0.14em] text-white">XBAR</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#52708d]">Private ranch command</div>
          </div>
        </div>

        <div className="rounded-[14px] border border-[#162436] bg-[#080f1c] p-4 shadow-[0_12px_28px_rgba(0,0,0,0.36)]">
          <div className="flex items-center justify-between gap-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#536d88]">Operating status</div>
            <span className={classNames('ops-pulse', opsUrgency !== 'clear' ? '' : '')}>
              <span className={classNames('ops-pulse__dot', opsUrgency === 'urgent' ? 'ops-pulse__dot--urgent' : opsUrgency === 'warning' ? 'ops-pulse__dot--warning' : '')} />
            </span>
          </div>
          <div className="mt-2 text-[0.96rem] font-bold leading-tight text-[#ddeaf8]">{workspaceProfile.ranchName || workspaceProfile.businessName || 'Primary ranch'}</div>
          <div className="mt-0.5 text-xs text-[#6f8aa5]">{commandState} · {roleWorkspace.label}</div>
          <div className="mt-3 grid grid-cols-2 gap-1.5 text-xs">
            <span className="rounded border border-[#142030] bg-[#08111d] px-2 py-1.5 text-[#6e8da6]">{horses.length} files</span>
            <span className={classNames('rounded border px-2 py-1.5', pendingTransfers > 0 ? 'border-[#5a1a1a] bg-[#1a0808] text-[#ff8a8a]' : 'border-[#142030] bg-[#08111d] text-[#6e8da6]')}>{pendingTransfers} transfers</span>
            <span className={classNames('rounded border px-2 py-1.5', pendingReview > 0 ? 'border-[#4a3800] bg-[#191000] text-[#fbbf24]' : 'border-[#142030] bg-[#08111d] text-[#6e8da6]')}>{pendingReview} proof</span>
            <span className="rounded border border-[#142030] bg-[#08111d] px-2 py-1.5 text-[#6e8da6]">{activeSales} buyers</span>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            <span className="inline-flex min-h-[24px] items-center rounded-full border border-[#1a2e46] bg-[#0a1628] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#7e98b2]">{subscription.tier}</span>
            <span className="inline-flex min-h-[24px] items-center rounded-full border border-[#1a3a6a] bg-[#0c1e3c] px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#65a6ff]">{localStatus}</span>
          </div>
        </div>

        <NavSection title="Command" items={sections.Command} badges={navBadges} />
        <NavSection title="Operations" items={sections.Operations} badges={navBadges} />
        <NavSection title="Control" items={sections.Control} badges={navBadges} />

        <div className="mt-auto border-t border-[#0a1624] pt-4 text-xs text-[#3d5870]">
          <div className="font-semibold uppercase tracking-[0.12em] text-[#4a6880]">Local command workspace</div>
          <div className="mt-1 text-[#2e4560]">{expenseReceipts.length} receipts · {documents.length} documents · {horses.length} horse records</div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="xbar-command-topbar sticky top-0 z-10 border-b border-[#122033] bg-[#07101d]/92 backdrop-blur">
          <div className="flex min-h-[62px] flex-wrap items-center justify-between gap-4 px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="text-[0.98rem] font-extrabold tracking-[0.01em] text-[#e9f2ff]">{currentLabel}</div>
              <span className={classNames('inline-flex min-h-[24px] items-center rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]', pendingReview || pendingTransfers ? 'border-[#314159] bg-[#111b2a] text-[#f0c76e]' : 'border-[#1e3b5d] bg-[#0b1c30] text-[#65a6ff]')}>
                {pendingReview || pendingTransfers ? `${pendingReview + pendingTransfers} open` : 'Control clear'}
              </span>
            </div>

            <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
              <label className="relative min-w-[220px] max-w-[420px] flex-1">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#748ba4]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={handleSearch}
                  onFocus={() => setCommandPaletteOpen(true)}
                  placeholder="Find horse record, proof, buyer, or action"
                  aria-label="Open XBAR search"
                  className="h-10 w-full rounded-md border border-[#1d3047] bg-[#0b1625] pl-10 pr-4 text-sm text-[#e9f2ff] transition-all duration-150 ease-[ease] placeholder:text-[#677f98] focus:border-[#4d94ff] focus:outline-none"
                />
                <kbd className="command-shortcut-hint">Ctrl K</kbd>
              </label>

              <div className="hidden h-10 items-center gap-3 rounded-md border border-[#1d3047] bg-[#0b1625] px-3 text-sm font-semibold text-[#d9e6f5] md:inline-flex">
                <span className="max-w-[190px] truncate">{accountLabel}</span>
                <span className="inline-flex rounded-sm border border-[#243952] bg-[#101d2d] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#7f9bb6]">{cloudSession ? currentRole : 'Local'}</span>
              </div>

              <button className="inline-flex h-10 items-center justify-center rounded-md border border-[#1d3047] bg-[#0b1625] px-4 text-sm font-semibold text-[#d9e6f5] transition-all duration-150 ease-[ease] hover:border-[#4d94ff] hover:bg-[#0f2033]" type="button" onClick={() => setHelpOpen(true)}>
                Guide
              </button>

              {cloudSession && canSyncCloud ? (
                <button className="inline-flex h-10 items-center justify-center rounded-md border border-[#1d3047] bg-[#0b1625] px-4 text-sm font-semibold text-[#d9e6f5] transition-all duration-150 ease-[ease] hover:border-[#4d94ff] hover:bg-[#0f2033]" type="button" onClick={() => void handleCloudSignOut()}>
                  Sign out
                </button>
              ) : null}

              <button className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#1d3047] bg-[#0b1625] text-[#d9e6f5] transition-all duration-150 ease-[ease] hover:border-[#4d94ff] hover:bg-[#0f2033]" type="button" onClick={() => navigate('/reminders')} aria-label="Open action queue">
                <BellIcon className="h-[18px] w-[18px]" />
                {pendingReview + pendingTransfers ? <span className="absolute right-0.5 top-0.5 min-w-[18px] rounded-full bg-[#CC3333] px-1.5 py-0.5 text-[10px] font-bold text-white">{pendingReview + pendingTransfers}</span> : null}
              </button>

              <button className="inline-flex h-10 items-center justify-center rounded-md border border-[#1d3047] bg-[#0b1625] px-4 text-sm font-semibold text-[#d9e6f5] transition-all duration-150 ease-[ease] hover:border-[#4d94ff] hover:bg-[#0f2033] disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={() => navigate('/documents?upload=1')} disabled={!canUploadDocuments}>
                Upload proof
              </button>

              <button className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#1155dd] px-4 text-sm font-semibold text-white shadow-sm transition-all duration-150 ease-[ease] hover:bg-[#0d44b0] disabled:cursor-not-allowed disabled:opacity-50" type="button" onClick={() => navigate('/horses?new=1')} disabled={!canCreateHorse}>
                <AddIcon className="h-[16px] w-[16px]" />
                New file
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
          <CommercialPressureBanner />
          <XbarIntelligenceRail />
          <div className="xbar-route-transition" key={location.pathname}>
            <Outlet />
          </div>
        </main>

        {mobileMoreOpen ? (
          <>
            <button className="fixed inset-0 z-30 bg-[#061426]/50 lg:hidden" type="button" aria-label="Close mobile menu" onClick={() => setMobileMoreOpen(false)} />
            <div id="mobile-more-menu" className="fixed bottom-[94px] left-3 right-3 z-50 rounded-lg border border-[#1d3047] bg-[#07101d] p-3 text-[#d9e6f5] shadow-xl lg:hidden">
              {canCreateHorse ? (
                <button className="mb-2 flex min-h-[50px] w-full items-center gap-3 rounded-md bg-[#1155dd] px-3 text-left text-sm font-semibold text-white" type="button" onClick={() => { setMobileMoreOpen(false); navigate('/horses?new=1'); }}>
                  <AddIcon className="h-[18px] w-[18px] shrink-0" />
                  <span>Add horse</span>
                </button>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                {mobileMoreItems.map(({ label, path, icon: Icon }) => {
                  const isActive = path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);
                  return (
                    <button key={label} className={classNames('flex min-h-[54px] items-center gap-3 rounded-md border px-3 text-left text-sm font-semibold transition-all duration-150 ease-[ease]', isActive ? 'border-[#4d94ff] bg-[#0d2040] text-white' : 'border-[#1d3047] bg-[#0b1625] text-[#9eb4ca] hover:border-[#4d94ff] hover:bg-[#0f2033]')} type="button" onClick={() => { setMobileMoreOpen(false); navigate(path); }}>
                      <Icon className="h-[18px] w-[18px] shrink-0" />
                      <span className="min-w-0 truncate">{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}

        <nav className="fixed bottom-3 left-3 right-3 z-40 grid grid-cols-5 gap-2 rounded-lg border border-[#1d3047] bg-[#07101d] p-2 text-[#d9e6f5] shadow-lg lg:hidden" aria-label="Mobile quick navigation">
          {([
            { label: 'Command', path: '/', icon: DashboardIcon, badge: pendingTransfers + careDueCount },
            { label: 'Files', path: '/horses', icon: HorsesIcon, badge: 0 },
            { label: 'Proof', path: '/documents', icon: DocumentsIcon, badge: pendingReview },
            { label: 'Buyers', path: '/sales', icon: SalesIcon, badge: 0 },
          ] as const).map(({ label, path, icon: Icon, badge }) => (
            <NavLink key={label} to={path} end={path === '/'} className={({ isActive }) => classNames('relative flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-md text-[11px] font-semibold transition-all duration-150 ease-[ease]', isActive ? 'bg-[#0d2040] text-white' : 'text-[#798ca3] hover:bg-[#0b1625] hover:text-[#d9e6f5]')}>
              <Icon className="h-[18px] w-[18px]" />
              <span>{label}</span>
              {badge > 0 ? <span className="absolute right-2 top-2 min-w-[16px] rounded-full bg-[#CC3333] px-1 py-px text-center text-[9px] font-bold text-white">{badge}</span> : null}
            </NavLink>
          ))}
          <button className={classNames('relative flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-md text-[11px] font-semibold transition-all duration-150 ease-[ease]', mobileMoreOpen || mobileMoreItems.some((item) => location.pathname.startsWith(item.path) && item.path !== '/') ? 'bg-[#0d2040] text-white' : 'text-[#798ca3] hover:bg-[#0b1625] hover:text-[#d9e6f5]')} type="button" onClick={() => setMobileMoreOpen((current) => !current)} aria-expanded={mobileMoreOpen} aria-controls="mobile-more-menu">
            <DotsIcon className="h-[18px] w-[18px]" />
            <span>More</span>
            {pendingTransfers + careDueCount > 0 ? <span className="absolute right-2 top-2 min-w-[16px] rounded-full bg-[#CC3333] px-1 py-px text-center text-[9px] font-bold text-white">{pendingTransfers + careDueCount}</span> : null}
          </button>
        </nav>
      </div>

      <WorkspaceHelp open={helpOpen} title={currentLabel} sections={helpSections} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
