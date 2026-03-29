import type { ComponentType, KeyboardEvent, SVGProps } from 'react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ContextMenu } from '@/components/ContextMenu';
import { WorkspaceHelp, type HelpSection } from '@/components/WorkspaceHelp';
import {
  AddIcon,
  AssetsIcon,
  BellIcon,
  BreedingIcon,
  DashboardIcon,
  DocumentsIcon,
  HorsesIcon,
  MedicalIcon,
  OwnershipIcon,
  SharedAccessIcon,
  SalesIcon,
  SearchIcon,
  SettingsIcon,
  SubscriptionIcon,
} from '@/components/icons';
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useCurrentRoleWorkspace, useXbarStore } from '@/store/useXbarStore';

type NavItem = {
  label: string;
  path: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

const operations: NavItem[] = [
  { label: 'Dashboard', path: '/', icon: DashboardIcon },
  { label: 'Horses', path: '/horses', icon: HorsesIcon },
  { label: 'Documents', path: '/documents', icon: DocumentsIcon },
  { label: 'Ownership', path: '/ownership', icon: OwnershipIcon },
];

const programs: NavItem[] = [
  { label: 'Medical', path: '/medical', icon: MedicalIcon },
  { label: 'Breeding', path: '/breeding', icon: BreedingIcon },
  { label: 'Sales', path: '/sales', icon: SalesIcon },
];

const platform: NavItem[] = [
  { label: 'Ranch Toolkit', path: '/assets', icon: AssetsIcon },
  { label: 'Subscriptions', path: '/subscriptions', icon: SubscriptionIcon },
  { label: 'Shared Access', path: '/shared-access', icon: SharedAccessIcon },
  { label: 'Settings', path: '/settings', icon: SettingsIcon },
];

const routeLabels: Record<string, string> = {
  '/': 'Dashboard',
  '/horses': 'Horses',
  '/documents': 'Documents',
  '/ownership': 'Ownership',
  '/medical': 'Medical',
  '/breeding': 'Breeding',
  '/sales': 'Sales',
  '/assets': 'Ranch Toolkit',
  '/subscriptions': 'Subscriptions',
  '/shared-access': 'Shared Access',
  '/settings': 'Settings',
};

const workspaceShortcutRoutes: Record<string, string> = {
  Dashboard: '/',
  Horses: '/horses',
  Documents: '/documents',
  Ownership: '/ownership',
  Medical: '/medical',
  Breeding: '/breeding',
  Sales: '/sales',
  'Ranch Toolkit': '/assets',
  'Ranch Assets': '/assets',
  Subscriptions: '/subscriptions',
  'Shared Access': '/shared-access',
  Settings: '/settings',
};

const workspaceShortcutOptions = [
  'Dashboard',
  'Horses',
  'Documents',
  'Ownership',
  'Medical',
  'Breeding',
  'Sales',
  'Ranch Toolkit',
  'Subscriptions',
  'Shared Access',
  'Settings',
] as const;

function normalizeShortcutLabel(module: string) {
  return module === 'Ranch Assets' ? 'Ranch Toolkit' : module;
}

const routeHelp: Record<string, HelpSection[]> = {
  Dashboard: [
    { label: 'Focus', text: 'Start with blockers and queue risk.' },
    { label: 'Actions', text: 'Open cards or right-click records for shortcuts.' },
  ],
  Horses: [
    { label: 'Browse', text: 'Cards and rows open the full horse record.' },
    { label: 'Create', text: 'Use New for intake and save only confirmed data.' },
  ],
  Documents: [
    { label: 'Intake', text: 'Upload first. Attach only when the match is clear.' },
    { label: 'Review', text: 'Approve, discard, or open files from the queue.' },
  ],
  Ownership: [
    { label: 'Transfer', text: 'Clear blockers and move transfers forward here.' },
    { label: 'Records', text: 'Right-click rows for transfer actions and jumps.' },
  ],
  Medical: [
    { label: 'Care', text: 'Track treatment, alerts, and visit cadence.' },
    { label: 'Actions', text: 'Right-click watch items for fast care actions.' },
  ],
  Breeding: [
    { label: 'Program', text: 'Manage pairings, milestones, and foaling work.' },
    { label: 'Actions', text: 'Right-click entries to jump or update quickly.' },
  ],
  Sales: [
    { label: 'Pipeline', text: 'Track leads, stages, and listing posture.' },
    { label: 'Actions', text: 'Right-click horses or leads for next-step actions.' },
  ],
  'Ranch Toolkit': [
    { label: 'Assets', text: 'Keep equipment, kits, and service work in one place.' },
    { label: 'Actions', text: 'Right-click rows to update status or jump out.' },
  ],
  Subscriptions: [
    { label: 'Billing', text: 'Track contract, billing path, and plan state.' },
    { label: 'Limits', text: 'Watch seats, storage, and access limits.' },
  ],
  'Shared Access': [
    { label: 'Shares', text: 'Stage the share list and monitor buyer-safe records.' },
    { label: 'Actions', text: 'Right-click saved horses for link shortcuts.' },
  ],
  Settings: [
    { label: 'Profile', text: 'Manage defaults, sync, and backup here.' },
    { label: 'Recovery', text: 'Use backup controls before large changes.' },
  ],
  'Horse Profile': [
    { label: 'Top row', text: 'Media, readiness, and share status sit up top.' },
    { label: 'Sections', text: 'Use the tabs below for docs, ops, and activity.' },
  ],
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function NavSection({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="mb-1 px-3 text-[9px] font-bold uppercase tracking-[0.30em] text-white/25">
        {title}
      </div>
      {items.map(({ label, path, icon: Icon }) => (
        <NavLink
          key={label}
          to={path}
          end={path === '/'}
          className={({ isActive }) =>
            cx(
              'group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-all duration-150',
              isActive
                ? 'bg-[#B87333]/[0.18] text-[#F4B460]'
                : 'text-white/50 hover:bg-white/[0.05] hover:text-white/85',
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && (
                <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-[#B87333]" />
              )}
              <Icon className="h-[17px] w-[17px] shrink-0" />
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
    </div>
  );
}

export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [shortcutEditorOpen, setShortcutEditorOpen] = useState(false);
  const [workspaceMenu, setWorkspaceMenu] = useState<{ x: number; y: number } | null>(null);

  const currentRole = useXbarStore((state) => state.currentRole);
  const subscription = useXbarStore((state) => state.subscription);
  const documents = useXbarStore((state) => state.documents);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const updateWorkspaceProfile = useXbarStore((state) => state.updateWorkspaceProfile);
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

  const platformItems = platform.filter((item) => {
    if (item.path === '/subscriptions') return canManageBilling;
    if (item.path === '/settings') return canManageSettings;
    return true;
  });

  const pendingReview = documents.filter(
    (d) => d.state === 'Needs Review' || d.state === 'Matched',
  ).length;

  const currentLabel = location.pathname.startsWith('/horses/')
    ? 'Horse Profile'
    : routeLabels[location.pathname] ?? 'Dashboard';

  const workspaceShortcutLabels = (
    workspaceProfile.workspaceShortcuts.length
      ? workspaceProfile.workspaceShortcuts
      : roleWorkspace.primaryModules.map(normalizeShortcutLabel)
  )
    .map(normalizeShortcutLabel)
    .filter((m, i, all) => all.indexOf(m) === i)
    .filter((m) => workspaceShortcutRoutes[m])
    .slice(0, 4);

  const workspaceShortcuts = workspaceShortcutLabels
    .map((m) => ({ label: m, path: workspaceShortcutRoutes[m] }))
    .filter((item): item is { label: string; path: string } => Boolean(item.path));

  const helpSections = routeHelp[currentLabel] ?? routeHelp.Dashboard;
  const accountLabel = cloudSession?.user?.email ?? currentRole;

  const workspaceMenuItems = [
    {
      id: 'edit-shortcuts',
      label: 'Edit shortcuts',
      onSelect: () => setShortcutEditorOpen(true),
    },
    {
      id: 'reset-shortcuts',
      label: 'Reset shortcuts',
      onSelect: () => {
        const result = updateWorkspaceProfile({ workspaceShortcuts: [] });
        pushToast({
          title: result.ok ? 'Shortcuts reset' : 'Reset blocked',
          message: result.ok
            ? 'Workspace shortcuts are back to role defaults.'
            : result.message,
          tone: result.ok ? 'success' : 'error',
        });
      },
    },
    { id: 'open-settings', label: 'Open settings', onSelect: () => navigate('/settings') },
  ];

  useEffect(() => { setHelpOpen(false); }, [location.pathname]);
  useEffect(() => { setShortcutEditorOpen(false); setWorkspaceMenu(null); }, [location.pathname]);

  const handleSearch = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && search.trim()) {
      navigate(`/horses?search=${encodeURIComponent(search.trim())}`);
    }
  };

  const handleShortcutToggle = (module: string) => {
    const next = workspaceShortcutLabels.includes(module)
      ? workspaceShortcutLabels.filter((m) => m !== module)
      : [...workspaceShortcutLabels, module].slice(0, 6);
    const result = updateWorkspaceProfile({ workspaceShortcuts: next });
    pushToast({
      title: result.ok ? 'Shortcuts updated' : 'Update blocked',
      message: result.ok ? 'Workspace shortcuts were saved.' : result.message,
      tone: result.ok ? 'success' : 'error',
    });
  };

  const handleCloudSignOut = async () => {
    const result = await signOutCloud();
    pushToast({
      title: result.ok ? 'Signed out' : 'Sign-out failed',
      message: result.message,
      tone: result.ok ? 'success' : 'error',
    });
    if (result.ok) navigate('/login', { replace: true });
  };

  const cloudBadgeLabel =
    cloudStatus === 'signed-in' ? 'Cloud' : cloudStatus === 'unavailable' ? 'Local' : 'Limited';

  return (
    <div className="min-h-screen bg-[#F6F3EF] lg:grid lg:grid-cols-[252px,1fr]">

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside className="hidden min-h-screen flex-col border-r border-white/[0.055] bg-[#141210] lg:flex">

        {/* Brand lockup */}
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#B87333] shadow-[0_2px_8px_rgba(184,115,51,0.45)]">
            <img
              src={`${import.meta.env.BASE_URL}xbar-logo-sleek.png`}
              alt="XBAR"
              className="h-6 w-6 object-contain brightness-[10]"
            />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[0.92rem] font-extrabold uppercase tracking-[0.16em] text-white">
              {workspaceProfile.businessName || 'XBAR'}
            </div>
            <div className="truncate text-[9px] font-semibold uppercase tracking-[0.28em] text-white/30">
              {workspaceProfile.ranchName || 'Horse Ledger'}
            </div>
          </div>
        </div>

        {/* Workspace card */}
        <div className="mx-3 mb-2">
          <div
            className="rounded-xl border border-white/[0.07] bg-white/[0.04] p-3.5"
            onContextMenu={(e) => {
              e.preventDefault();
              setWorkspaceMenu({ x: e.clientX, y: e.clientY });
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[9px] font-bold uppercase tracking-[0.28em] text-white/25">
                  Workspace
                </div>
                <div className="mt-1 truncate text-[0.84rem] font-semibold text-white/70">
                  {roleWorkspace.label}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span
                  className={cx(
                    'inline-flex items-center rounded-md px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em]',
                    cloudStatus === 'signed-in'
                      ? 'bg-emerald-500/15 text-emerald-400'
                      : cloudStatus === 'unavailable'
                        ? 'bg-white/[0.07] text-white/35'
                        : 'bg-amber-500/15 text-amber-400',
                  )}
                >
                  {cloudBadgeLabel}
                </span>
                <button
                  type="button"
                  onClick={() => setShortcutEditorOpen(true)}
                  className="inline-flex items-center rounded-md bg-white/[0.06] px-2 py-0.5 text-[9px] font-bold uppercase tracking-[0.18em] text-white/35 transition-colors hover:bg-white/[0.10] hover:text-white/60"
                >
                  Edit
                </button>
              </div>
            </div>
            {workspaceShortcuts.length > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-1.5">
                {workspaceShortcuts.map((sc) => (
                  <button
                    key={sc.label}
                    type="button"
                    onClick={() => navigate(sc.path)}
                    className="rounded-lg bg-white/[0.05] px-2.5 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-white/45 transition-colors hover:bg-white/[0.09] hover:text-white/75"
                  >
                    {sc.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-5 overflow-y-auto px-3 py-3" aria-label="Main navigation">
          <NavSection title="Operations" items={operations} />
          <NavSection title="Programs" items={programs} />
          <NavSection title="Platform" items={platformItems} />
        </nav>

        {/* Sidebar footer */}
        <div className="border-t border-white/[0.06] px-5 py-4">
          <div className="flex items-center justify-between">
            <span className="text-[9px] font-bold uppercase tracking-[0.24em] text-white/20">
              {subscription.tier}
            </span>
            <button
              type="button"
              onClick={() => navigate('/settings')}
              className="rounded-md bg-white/[0.05] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.18em] text-white/30 transition-colors hover:bg-white/[0.09] hover:text-white/60"
            >
              Settings
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content area ───────────────────────────────── */}
      <div className="flex min-w-0 flex-col">

        {/* Topbar */}
        <header className="sticky top-0 z-10 border-b border-[#E4DDD6] bg-white/95 backdrop-blur-xl">
          <div className="flex min-h-[58px] items-center justify-between gap-3 px-5 py-2.5">

            {/* Left: page title + status */}
            <div className="flex items-center gap-2.5">
              <h1 className="text-[0.95rem] font-bold tracking-[-0.01em] text-[#1A1614]">
                {currentLabel}
              </h1>
              <span
                className={cx(
                  'inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold',
                  pendingReview
                    ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
                    : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
                )}
              >
                {pendingReview ? `${pendingReview} review` : 'Live'}
              </span>
            </div>

            {/* Right: controls */}
            <div className="flex flex-1 flex-wrap items-center justify-end gap-2">

              {/* Search */}
              <label className="relative min-w-[200px] max-w-[380px] flex-1">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-[16px] w-[16px] -translate-y-1/2 text-[#9B9490]" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={handleSearch}
                  placeholder="Search horses…"
                  className="h-9 w-full rounded-lg border border-[#E4DDD6] bg-[#F9F7F4] pl-9 pr-3 text-[13px] text-[#1A1614] placeholder:text-[#9B9490] transition-all focus:border-[#B87333] focus:bg-white focus:outline-none focus:ring-2 focus:ring-[#B87333]/15"
                />
              </label>

              {/* Account chip */}
              <div className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#E4DDD6] bg-white px-3 text-[13px] font-medium text-[#1A1614]">
                <span className="max-w-[160px] truncate">{accountLabel}</span>
                <span
                  className={cx(
                    'inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.14em]',
                    cloudSession
                      ? 'bg-emerald-50 text-emerald-700'
                      : cloudStatus === 'unavailable'
                        ? 'bg-[#F0EDE9] text-[#6B6460]'
                        : 'bg-sky-50 text-sky-700',
                  )}
                >
                  {cloudSession ? currentRole : cloudStatus === 'unavailable' ? 'Local' : 'Guest'}
                </span>
              </div>

              {/* Help */}
              <button
                type="button"
                onClick={() => setHelpOpen(true)}
                className="inline-flex h-9 items-center rounded-lg border border-[#E4DDD6] bg-white px-3.5 text-[13px] font-semibold text-[#4A4440] transition-all hover:border-[#D6CEC6] hover:bg-[#F6F3EF]"
              >
                Help
              </button>

              {/* Sign out */}
              {cloudSession && canSyncCloud ? (
                <button
                  type="button"
                  onClick={() => void handleCloudSignOut()}
                  className="inline-flex h-9 items-center rounded-lg border border-[#E4DDD6] bg-white px-3.5 text-[13px] font-semibold text-[#4A4440] transition-all hover:border-[#D6CEC6] hover:bg-[#F6F3EF]"
                >
                  Sign out
                </button>
              ) : null}

              {/* Bell */}
              <button
                type="button"
                onClick={() => navigate('/documents')}
                aria-label="Open document review"
                className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[#E4DDD6] bg-white text-[#4A4440] transition-all hover:border-[#D6CEC6] hover:bg-[#F6F3EF]"
              >
                <BellIcon className="h-[17px] w-[17px]" />
                {pendingReview ? (
                  <span className="absolute right-0.5 top-0.5 min-w-[16px] rounded-full bg-[#DC2626] px-1 py-px text-[9px] font-bold leading-none text-white">
                    {pendingReview}
                  </span>
                ) : null}
              </button>

              {/* Intake */}
              <button
                type="button"
                onClick={() => navigate('/documents?upload=1')}
                disabled={!canUploadDocuments}
                className="inline-flex h-9 items-center rounded-lg border border-[#E4DDD6] bg-white px-3.5 text-[13px] font-semibold text-[#4A4440] transition-all hover:border-[#D6CEC6] hover:bg-[#F6F3EF] disabled:cursor-not-allowed disabled:opacity-40"
              >
                Intake
              </button>

              {/* New horse — brand CTA */}
              <button
                type="button"
                onClick={() => navigate('/horses?new=1')}
                disabled={!canCreateHorse}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#B87333] px-4 text-[13px] font-bold text-white shadow-sm transition-all hover:bg-[#A06828] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <AddIcon className="h-[15px] w-[15px]" />
                New Horse
              </button>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex flex-col gap-5 px-6 py-5 pb-24 lg:pb-5">
          <Outlet />
        </main>

        {/* Mobile bottom dock */}
        <nav
          className="fixed bottom-3 left-3 right-3 z-40 grid grid-cols-5 gap-1.5 rounded-2xl border border-[#E4DDD6] bg-white/95 p-2 shadow-lift backdrop-blur-xl lg:hidden"
          aria-label="Mobile navigation"
        >
          {[
            { to: '/', end: true, icon: DashboardIcon, label: 'Home' },
            { to: '/horses', end: false, icon: HorsesIcon, label: 'Horses' },
            { to: '/documents', end: false, icon: DocumentsIcon, label: 'Docs' },
            { to: '/sales', end: false, icon: SalesIcon, label: 'Sales' },
          ].map(({ to, end, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cx(
                  'flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold transition-all',
                  isActive
                    ? 'bg-[#B87333]/[0.10] text-[#B87333]'
                    : 'text-[#6B6460] hover:bg-[#F6F3EF] hover:text-[#1A1614]',
                )
              }
            >
              <Icon className="h-[19px] w-[19px]" />
              <span>{label}</span>
            </NavLink>
          ))}
          <button
            type="button"
            onClick={() => navigate('/horses?new=1')}
            disabled={!canCreateHorse}
            className="flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-xl bg-[#B87333] text-[10px] font-bold text-white shadow-sm transition-all hover:bg-[#A06828] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <AddIcon className="h-[19px] w-[19px]" />
            <span>New</span>
          </button>
        </nav>
      </div>

      {/* Panels & overlays */}
      <WorkspaceHelp open={helpOpen} title={currentLabel} sections={helpSections} onClose={() => setHelpOpen(false)} />

      {shortcutEditorOpen ? (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-end bg-black/30 p-4 backdrop-blur-sm"
          onClick={() => setShortcutEditorOpen(false)}
          role="presentation"
        >
          <aside
            className="w-full max-w-[340px] rounded-2xl border border-[#E4DDD6] bg-white p-5 shadow-lift"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Edit workspace shortcuts"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[9px] font-bold uppercase tracking-[0.28em] text-[#9B9490]">
                  Workspace
                </div>
                <h2 className="mt-1.5 text-[1.05rem] font-bold tracking-[-0.02em] text-[#1A1614]">
                  Edit shortcuts
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShortcutEditorOpen(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E4DDD6] text-[#6B6460] transition-all hover:border-[#B87333]/30 hover:text-[#B87333]"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {workspaceShortcutOptions.map((module) => {
                const active = workspaceShortcutLabels.includes(module);
                return (
                  <button
                    key={module}
                    type="button"
                    onClick={() => handleShortcutToggle(module)}
                    className={cx(
                      'rounded-xl border px-3 py-2.5 text-left text-[12px] font-semibold transition-all',
                      active
                        ? 'border-[#B87333] bg-[#B87333] text-white shadow-sm'
                        : 'border-[#E4DDD6] bg-[#F9F7F4] text-[#1A1614] hover:border-[#B87333]/40 hover:bg-[#FDF6EE]',
                    )}
                  >
                    {module}
                  </button>
                );
              })}
            </div>
            <p className="mt-4 text-[11px] leading-5 text-[#9B9490]">
              Right-click the workspace card any time to reopen this editor.
            </p>
          </aside>
        </div>
      ) : null}

      <ContextMenu
        open={Boolean(workspaceMenu)}
        x={workspaceMenu?.x ?? 0}
        y={workspaceMenu?.y ?? 0}
        items={workspaceMenuItems}
        onClose={() => setWorkspaceMenu(null)}
      />
    </div>
  );
}
