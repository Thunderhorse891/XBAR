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
      <div className="px-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-[#a99b8d]">{title}</div>
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
                  ? 'border-[#3d6b4f] bg-[#f1ece5] text-[#201d1a]'
                  : 'border-transparent text-[#d1c6bb] hover:border-[#7f7064] hover:bg-white/5 hover:text-[#fffaf3]',
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
    <div className="min-h-screen bg-[#f4f1ec] lg:grid lg:grid-cols-[248px,1fr]">
      <aside className="hidden min-h-screen flex-col gap-6 border-r border-[#41362d]/35 bg-[#312a24] px-5 py-5 text-[#f3ede5] lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-[52px] w-[52px] items-center justify-center rounded-lg border border-[#5d5146] bg-[linear-gradient(145deg,#433931_0%,#2a241f_100%)] p-1.5 shadow-sm">
            <img src={`${import.meta.env.BASE_URL}xbar-logo-sleek.png`} alt="XBAR logo" className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[1.04rem] font-extrabold uppercase tracking-[0.14em]">{workspaceProfile.businessName || 'XBAR'}</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#b7a99b]">{workspaceProfile.ranchName || 'Horse Ledger'}</div>
          </div>
        </div>

        <div
          className="rounded-[12px] border border-[#5d5146] bg-[linear-gradient(145deg,#3a322b_0%,#332b25_100%)] p-4 shadow-sm"
          onContextMenu={(event) => {
            event.preventDefault();
            setWorkspaceMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          <div className="flex flex-col gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#b7a99b]">Workspace</div>
              <div className="mt-2 text-[0.95rem] font-semibold text-[#f7f1e8]">{roleWorkspace.label}</div>
            </div>
            <div className="shrink-0 self-start overflow-hidden rounded-full border border-[#5d5146] bg-[#2d2621] shadow-sm">
              <div className="flex items-center">
                <span className="inline-flex min-h-[32px] items-center border-r border-[#5d5146] bg-[#edf3ed] px-3.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#3d6b4f]">
                  {cloudStatus === 'signed-in' ? 'Cloud' : cloudStatus === 'unavailable' ? 'Local' : 'Limited'}
                </span>
                <button
                  type="button"
                  onClick={() => setShortcutEditorOpen(true)}
                  className="inline-flex min-h-[32px] items-center px-3.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#d1c6bb] transition-all duration-150 ease-[ease] hover:bg-white/5 hover:text-[#fffaf3]"
                >
                  Edit
                </button>
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {workspaceShortcuts.map((module) => (
              <button
                key={module.label}
                type="button"
                onClick={() => navigate(module.path)}
                className="rounded-[10px] border border-[#5d5146] bg-[#f8f3ec] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-[#54493f] transition-all duration-150 ease-[ease] hover:border-[#3d6b4f] hover:bg-[#f2ede6] hover:text-[#201d1a]"
              >
                {module.label}
              </button>
            ))}
          </div>
        </div>

        <NavSection title="Operations" items={operations} />
        <NavSection title="Programs" items={programs} />
        <NavSection title="Platform" items={platformItems} />

        <div className="mt-auto flex items-center justify-between gap-3 border-t border-[#4b4037] pt-4 text-xs text-[#b7a99b]">
          <span>{subscription.tier}</span>
          <button
            type="button"
            onClick={() => navigate('/settings')}
            className="rounded-[10px] border border-[#5d5146] bg-[#2d2621] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#d1c6bb] transition-all duration-150 ease-[ease] hover:border-[#7f7064] hover:bg-[#3a322b] hover:text-[#fffaf3]"
          >
            Settings
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col bg-[#f4f1ec]">
        <header className="sticky top-0 z-10 border-b border-[#ddd3c7] bg-[#fffdfa]/92 backdrop-blur">
          <div className="flex min-h-[56px] flex-wrap items-center justify-between gap-4 px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="text-[0.96rem] font-extrabold tracking-[0.01em] text-[#201d1a]">{currentLabel}</div>
              <span
                className={classNames(
                  'inline-flex min-h-[24px] items-center rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]',
                  pendingReview ? 'border-[#d6cdc1] bg-[#fffaf3] text-[#6f655b]' : 'border-[#d7e6dd] bg-[#edf4ee] text-[#365642]',
                )}
              >
                {pendingReview ? `${pendingReview} review` : 'Live'}
              </span>
            </div>

            <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
              <label className="relative min-w-[220px] max-w-[420px] flex-1">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#7a6d61]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={handleSearch}
                  placeholder="Search"
                  className="h-10 w-full rounded-md border border-[#ddd3c7] bg-[#fffdfa] pl-10 pr-4 text-sm text-[#201d1a] transition-all duration-150 ease-[ease] placeholder:text-[#8f8378] focus:border-[#3d6b4f] focus:outline-none"
                />
              </label>

              <div className="inline-flex h-10 items-center gap-3 rounded-md border border-[#ddd3c7] bg-[#fffdfa] px-3 text-sm font-semibold text-[#201d1a]">
                <span className="max-w-[190px] truncate">{accountLabel}</span>
                <span className={classNames('inline-flex rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]',
                  cloudStatus === 'signed-in'
                    ? 'border-[#d7e6dd] bg-[#edf4ee] text-[#365642]'
                    : cloudStatus === 'unavailable'
                      ? 'border-[#e3dbd0] bg-[#f4efe8] text-[#726659]'
                      : 'border-[#e3dbd0] bg-[#f3eee7] text-[#5a5148]',
                )}>
                  {cloudSession ? currentRole : cloudStatus === 'unavailable' ? 'Local' : 'Guest'}
                </span>
              </div>

              <button
                className="inline-flex h-10 items-center justify-center rounded-md border border-[#ddd3c7] bg-[#fffdfa] px-4 text-sm font-semibold text-[#201d1a] transition-all duration-150 ease-[ease] hover:border-[#3d6b4f] hover:bg-[#f5f0e9]"
                type="button"
                onClick={() => setHelpOpen(true)}
              >
                Help
              </button>

              {cloudSession && canSyncCloud ? (
                <button
                  className="inline-flex h-10 items-center justify-center rounded-md border border-[#ddd3c7] bg-[#fffdfa] px-4 text-sm font-semibold text-[#201d1a] transition-all duration-150 ease-[ease] hover:border-[#3d6b4f] hover:bg-[#f5f0e9]"
                  type="button"
                  onClick={() => void handleCloudSignOut()}
                >
                  Sign out
                </button>
              ) : null}

              <button
                className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#ddd3c7] bg-[#fffdfa] text-[#201d1a] transition-all duration-150 ease-[ease] hover:border-[#3d6b4f] hover:bg-[#f5f0e9] disabled:cursor-not-allowed disabled:opacity-50"
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
                className="inline-flex h-10 items-center justify-center rounded-md border border-[#ddd3c7] bg-[#fffdfa] px-4 text-sm font-semibold text-[#201d1a] transition-all duration-150 ease-[ease] hover:border-[#3d6b4f] hover:bg-[#f5f0e9] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => navigate('/documents?upload=1')}
                disabled={!canUploadDocuments}
              >
                Intake
              </button>

              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#3d6b4f] px-4 text-sm font-semibold text-white shadow-sm transition-all duration-150 ease-[ease] hover:bg-[#305540] disabled:cursor-not-allowed disabled:opacity-50"
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

        <nav className="fixed bottom-3 left-3 right-3 z-40 grid grid-cols-5 gap-2 rounded-lg border border-[#ddd3c7] bg-[#fffdfa] p-2 text-[#201d1a] shadow-lg lg:hidden" aria-label="Mobile quick navigation">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              classNames(
                'flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-md text-[11px] font-semibold transition-all duration-150 ease-[ease]',
                isActive ? 'bg-[#edf4ee] text-[#3d6b4f]' : 'text-[#7a6d61] hover:bg-[#f6f1ea] hover:text-[#201d1a]',
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
                isActive ? 'bg-[#edf4ee] text-[#3d6b4f]' : 'text-[#7a6d61] hover:bg-[#f6f1ea] hover:text-[#201d1a]',
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
                isActive ? 'bg-[#edf4ee] text-[#3d6b4f]' : 'text-[#7a6d61] hover:bg-[#f6f1ea] hover:text-[#201d1a]',
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
                isActive ? 'bg-[#edf4ee] text-[#3d6b4f]' : 'text-[#7a6d61] hover:bg-[#f6f1ea] hover:text-[#201d1a]',
              )
            }
          >
            <SalesIcon className="h-[18px] w-[18px]" />
            <span>Sales</span>
          </NavLink>
          <button
            className="flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-md bg-[#3d6b4f] text-[11px] font-semibold text-white transition-all duration-150 ease-[ease] hover:bg-[#305540] disabled:cursor-not-allowed disabled:opacity-50"
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
          <div className="fixed inset-0 z-[120] flex items-center justify-end bg-[#2c2621]/28 p-4 backdrop-blur-[2px]" onClick={() => setShortcutEditorOpen(false)} role="presentation">
            <aside
              className="w-full max-w-[360px] rounded-[12px] border border-[#ddd3c7] bg-[#fffdfa] p-5 shadow-xl"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-label="Edit workspace shortcuts"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#8f8378]">Workspace</div>
                  <h2 className="mt-2 text-lg font-bold tracking-[-0.04em] text-[#201d1a]">Edit shortcuts</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setShortcutEditorOpen(false)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[#ddd3c7] text-[#726659] transition-all duration-150 ease-[ease] hover:border-[#3d6b4f]/20 hover:text-[#201d1a]"
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
                          ? 'border-[#3d6b4f] bg-[#3d6b4f] text-white'
                          : 'border-[#ddd3c7] bg-white text-[#201d1a] hover:border-[#3d6b4f] hover:bg-[#f5f0e9]',
                      )}
                    >
                      {module}
                    </button>
                  );
                })}
              </div>
              <div className="mt-4 text-xs leading-6 text-[#726659]">Right-click the workspace card any time to reopen this editor.</div>
            </aside>
          </div>
        ) : null}
        <ContextMenu open={Boolean(workspaceMenu)} x={workspaceMenu?.x ?? 0} y={workspaceMenu?.y ?? 0} items={workspaceMenuItems} onClose={() => setWorkspaceMenu(null)} />
      </div>
    </div>
  );
}



