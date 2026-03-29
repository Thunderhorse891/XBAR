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

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function NavSection({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="px-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-[#8f8276]">{title}</div>
      <div className="flex flex-col gap-1">
        {items.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={label}
            to={path}
            end={path === '/'}
            className={({ isActive }) =>
              classNames(
                'group flex items-center gap-3 border-l-[3px] px-3 py-2.5 text-sm font-medium transition-all duration-150 ease-[ease]',
                isActive
                  ? 'border-[#202225] bg-white text-[#202225] shadow-sm'
                  : 'border-transparent text-[#5b6670] hover:border-[#d5ccc2] hover:bg-white/70 hover:text-[#202225]',
              )
            }
          >
            <Icon className="h-[18px] w-[18px] shrink-0" />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
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
    if (item.path === '/subscriptions') {
      return canManageBilling;
    }
    if (item.path === '/settings') {
      return canManageSettings;
    }
    return true;
  });

  const pendingReview = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Matched').length;
  const currentLabel = location.pathname.startsWith('/horses/') ? 'Horse Profile' : routeLabels[location.pathname] ?? 'Dashboard';
  const workspaceShortcutLabels = (workspaceProfile.workspaceShortcuts.length ? workspaceProfile.workspaceShortcuts : roleWorkspace.primaryModules.map(normalizeShortcutLabel))
    .map(normalizeShortcutLabel)
    .filter((module, index, all) => all.indexOf(module) === index)
    .filter((module) => workspaceShortcutRoutes[module])
    .slice(0, 4);
  const workspaceShortcuts = workspaceShortcutLabels
    .map((module) => ({
      label: module,
      path: workspaceShortcutRoutes[module],
    }))
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
          message: result.ok ? 'Workspace shortcuts are back to role defaults.' : result.message,
          tone: result.ok ? 'success' : 'error',
        });
      },
    },
    {
      id: 'open-settings',
      label: 'Open settings',
      onSelect: () => navigate('/settings'),
    },
  ];

  useEffect(() => {
    setHelpOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    setShortcutEditorOpen(false);
    setWorkspaceMenu(null);
  }, [location.pathname]);

  const handleSearch = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && search.trim()) {
      navigate(`/horses?search=${encodeURIComponent(search.trim())}`);
    }
  };

  const handleShortcutToggle = (module: string) => {
    const nextSelection = workspaceShortcutLabels.includes(module)
      ? workspaceShortcutLabels.filter((item) => item !== module)
      : [...workspaceShortcutLabels, module].slice(0, 6);
    const result = updateWorkspaceProfile({ workspaceShortcuts: nextSelection });
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
    if (result.ok) {
      navigate('/login', { replace: true });
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f1eb] lg:grid lg:grid-cols-[248px,1fr]">
      <aside className="hidden min-h-screen flex-col gap-6 border-r border-[#e5ddd2] bg-[#f8f4ee] px-5 py-5 text-[#202225] lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-[52px] w-[52px] items-center justify-center rounded-lg border border-[#e5ddd2] bg-white p-1.5 shadow-sm">
            <img src={`${import.meta.env.BASE_URL}xbar-logo-sleek.png`} alt="XBAR logo" className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[1.04rem] font-extrabold uppercase tracking-[0.14em]">{workspaceProfile.businessName || 'XBAR'}</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#8f8276]">{workspaceProfile.ranchName || 'Horse Ledger'}</div>
          </div>
        </div>

        <div
          className="rounded-[10px] border border-[#e5ddd2] bg-[#fcfaf7] p-4 shadow-sm"
          onContextMenu={(event) => {
            event.preventDefault();
            setWorkspaceMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#8f8276]">Workspace</div>
              <div className="mt-2 text-[0.95rem] font-semibold text-[#202225]">{roleWorkspace.label}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex min-h-[24px] items-center rounded-md border border-[#d9cfc4] bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#756b63]">
                {cloudStatus === 'signed-in' ? 'Cloud' : cloudStatus === 'unavailable' ? 'Local' : 'Limited'}
              </span>
              <button
                type="button"
                onClick={() => setShortcutEditorOpen(true)}
                className="inline-flex min-h-[24px] items-center rounded-md border border-[#d9cfc4] bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5d6771] transition-all duration-150 ease-[ease] hover:border-[#cbbfb2] hover:bg-[#f8f3ed] hover:text-[#202225]"
              >
                Edit
              </button>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {workspaceShortcuts.map((module) => (
              <button
                key={module.label}
                type="button"
                onClick={() => navigate(module.path)}
                className="rounded-md border border-[#e5ddd2] bg-white px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-[#5b6670] transition-all duration-150 ease-[ease] hover:border-[#cbbfb2] hover:bg-[#f8f3ed] hover:text-[#202225]"
              >
                {module.label}
              </button>
            ))}
          </div>
        </div>

        <NavSection title="Operations" items={operations} />
        <NavSection title="Programs" items={programs} />
        <NavSection title="Platform" items={platformItems} />

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-[#e5ddd2] pt-4 text-xs text-[#8f8276]">
          <span>{subscription.tier}</span>
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="rounded-md border border-[#e5ddd2] bg-white px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#5b6670] transition-all duration-150 ease-[ease] hover:border-[#cbbfb2] hover:bg-[#f8f3ed] hover:text-[#202225]"
          >
            Settings
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col bg-[#f5f1eb]">
        <header className="sticky top-0 z-10 border-b border-[#e5ddd2] bg-[#fbf8f4]/92 backdrop-blur">
          <div className="flex min-h-[56px] flex-wrap items-center justify-between gap-4 px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="text-[0.96rem] font-extrabold tracking-[0.01em] text-[#202225]">{currentLabel}</div>
              <span
                className={classNames(
                  'inline-flex min-h-[24px] items-center rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]',
                  pendingReview ? 'border-[#ddd4ca] bg-white text-[#5b6670]' : 'border-[#d7e6dd] bg-[#f3faf6] text-[#2b6a4c]',
                )}
              >
                {pendingReview ? `${pendingReview} review` : 'Live'}
              </span>
            </div>

            <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
              <label className="relative min-w-[220px] max-w-[420px] flex-1">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#7b8794]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={handleSearch}
                  placeholder="Search"
                  className="h-10 w-full rounded-md border border-[#d5cdc2] bg-white pl-10 pr-4 text-sm text-[#202225] transition-all duration-150 ease-[ease] placeholder:text-[#8a96a3] focus:border-[#8f8276] focus:outline-none"
                />
              </label>

              <div className="inline-flex h-10 items-center gap-3 rounded-md border border-[#d5cdc2] bg-white px-3 text-sm font-semibold text-[#202225]">
                <span className="max-w-[190px] truncate">{accountLabel}</span>
                <span className={classNames('inline-flex rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]',
                  cloudStatus === 'signed-in'
                    ? 'border-[#d7e6dd] bg-[#f3faf6] text-[#2b6a4c]'
                    : cloudStatus === 'unavailable'
                      ? 'border-[#e2e5ea] bg-[#f4f5f7] text-[#667085]'
                      : 'border-[#dce5eb] bg-[#f3f7fa] text-[#405b6a]',
                )}>
                  {cloudSession ? currentRole : cloudStatus === 'unavailable' ? 'Local' : 'Guest'}
                </span>
              </div>

              <button
                className="inline-flex h-10 items-center justify-center rounded-md border border-[#d5cdc2] bg-white px-4 text-sm font-semibold text-[#202225] transition-all duration-150 ease-[ease] hover:border-[#cbbfb2] hover:bg-[#f8f3ed]"
                type="button"
                onClick={() => setHelpOpen(true)}
              >
                Help
              </button>

              {cloudSession && canSyncCloud ? (
                <button
                  className="inline-flex h-10 items-center justify-center rounded-md border border-[#d5cdc2] bg-white px-4 text-sm font-semibold text-[#202225] transition-all duration-150 ease-[ease] hover:border-[#cbbfb2] hover:bg-[#f8f3ed]"
                  type="button"
                  onClick={() => void handleCloudSignOut()}
                >
                  Sign out
                </button>
              ) : null}

              <button
                className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#d5cdc2] bg-white text-[#202225] transition-all duration-150 ease-[ease] hover:border-[#cbbfb2] hover:bg-[#f8f3ed] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => navigate('/documents')}
                aria-label="Open document review"
              >
                <BellIcon className="h-[18px] w-[18px]" />
                {pendingReview ? (
                  <span className="absolute right-0.5 top-0.5 min-w-[18px] rounded-full bg-[#CC3333] px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {pendingReview}
                  </span>
                ) : null}
              </button>

              <button
                className="inline-flex h-10 items-center justify-center rounded-md border border-[#d5cdc2] bg-white px-4 text-sm font-semibold text-[#202225] transition-all duration-150 ease-[ease] hover:border-[#cbbfb2] hover:bg-[#f8f3ed] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => navigate('/documents?upload=1')}
                disabled={!canUploadDocuments}
              >
                Intake
              </button>

              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#202225] px-4 text-sm font-semibold text-white shadow-sm transition-all duration-150 ease-[ease] hover:bg-[#111315] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => navigate('/horses?new=1')}
                disabled={!canCreateHorse}
              >
                <AddIcon className="h-[16px] w-[16px]" />
                New
              </button>
            </div>
          </div>
        </header>

        <main className="flex flex-col gap-[18px] px-6 py-5">
          <Outlet />
        </main>

        <nav className="fixed bottom-3 left-3 right-3 z-40 grid grid-cols-5 gap-2 rounded-lg border border-[#e5ddd2] bg-[#fbf8f4] p-2 text-[#202225] shadow-lg lg:hidden" aria-label="Mobile quick navigation">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              classNames(
                'flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-md text-[11px] font-semibold transition-all duration-150 ease-[ease]',
                isActive ? 'bg-[#f3ece4] text-[#202225]' : 'text-[#6b7280] hover:bg-white hover:text-[#202225]',
              )
            }
          >
            <DashboardIcon className="h-[18px] w-[18px]" />
            <span>Home</span>
          </NavLink>
          <NavLink
            to="/horses"
            className={({ isActive }) =>
              classNames(
                'flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-md text-[11px] font-semibold transition-all duration-150 ease-[ease]',
                isActive ? 'bg-[#f3ece4] text-[#202225]' : 'text-[#6b7280] hover:bg-white hover:text-[#202225]',
              )
            }
          >
            <HorsesIcon className="h-[18px] w-[18px]" />
            <span>Horses</span>
          </NavLink>
          <NavLink
            to="/documents"
            className={({ isActive }) =>
              classNames(
                'flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-md text-[11px] font-semibold transition-all duration-150 ease-[ease]',
                isActive ? 'bg-[#f3ece4] text-[#202225]' : 'text-[#6b7280] hover:bg-white hover:text-[#202225]',
              )
            }
          >
            <DocumentsIcon className="h-[18px] w-[18px]" />
            <span>Docs</span>
          </NavLink>
          <NavLink
            to="/sales"
            className={({ isActive }) =>
              classNames(
                'flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-md text-[11px] font-semibold transition-all duration-150 ease-[ease]',
                isActive ? 'bg-[#f3ece4] text-[#202225]' : 'text-[#6b7280] hover:bg-white hover:text-[#202225]',
              )
            }
          >
            <SalesIcon className="h-[18px] w-[18px]" />
            <span>Sales</span>
          </NavLink>
          <button
            className="flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-md bg-[#202225] text-[11px] font-semibold text-white transition-all duration-150 ease-[ease] hover:bg-[#111315] disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={() => navigate('/horses?new=1')}
            disabled={!canCreateHorse}
          >
            <AddIcon className="h-[18px] w-[18px]" />
            <span>New</span>
          </button>
        </nav>

        <WorkspaceHelp open={helpOpen} title={currentLabel} sections={helpSections} onClose={() => setHelpOpen(false)} />
        {shortcutEditorOpen ? (
          <div className="fixed inset-0 z-[120] flex items-center justify-end bg-[#f0e9e1]/70 p-4 backdrop-blur-[2px]" onClick={() => setShortcutEditorOpen(false)} role="presentation">
            <aside
              className="w-full max-w-[360px] rounded-[12px] border border-[#e5ddd2] bg-[#fffdfb] p-5 shadow-xl"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Edit workspace shortcuts"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#667085]">Workspace</div>
                  <h2 className="mt-2 text-lg font-bold tracking-[-0.04em] text-[#202225]">Edit shortcuts</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setShortcutEditorOpen(false)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#dce4ec] text-[#667085] transition-all duration-150 ease-[ease] hover:border-[#202225]/20 hover:text-[#202225]"
                  aria-label="Close shortcut editor"
                >
                  ×
                </button>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                {workspaceShortcutOptions.map((module) => {
                  const active = workspaceShortcutLabels.includes(module);
                  return (
                    <button
                      key={module}
                      type="button"
                      onClick={() => handleShortcutToggle(module)}
                      className={classNames(
                        'rounded-md border px-3 py-3 text-left text-sm font-semibold transition-all duration-150 ease-[ease]',
                        active
                          ? 'border-[#202225] bg-[#202225] text-white'
                          : 'border-[#e5ddd2] bg-white text-[#202225] hover:border-[#cbbfb2] hover:bg-[#f8f3ed]',
                      )}
                    >
                      {module}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 text-xs leading-6 text-[#667085]">Right-click the workspace card any time to reopen this editor.</div>
            </aside>
          </div>
        ) : null}
        <ContextMenu open={Boolean(workspaceMenu)} x={workspaceMenu?.x ?? 0} y={workspaceMenu?.y ?? 0} items={workspaceMenuItems} onClose={() => setWorkspaceMenu(null)} />
      </div>
    </div>
  );
}


