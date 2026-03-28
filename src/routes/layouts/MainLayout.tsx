import type { ComponentType, KeyboardEvent, SVGProps } from 'react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Pill } from '@/components/app-ui';
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
  'Ranch Assets': '/assets',
  Subscriptions: '/subscriptions',
  'Shared Access': '/shared-access',
  Settings: '/settings',
};

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
      <div className="px-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-white/32">{title}</div>
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
                  ? 'border-[#4d6675] bg-white/[0.06] text-white'
                  : 'border-transparent text-white/68 hover:border-white/10 hover:bg-white/[0.03] hover:text-white',
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
  const currentRole = useXbarStore((state) => state.currentRole);
  const subscription = useXbarStore((state) => state.subscription);
  const documents = useXbarStore((state) => state.documents);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
  const cloudStatus = useCloudStore((state) => state.status);
  const roleWorkspace = useCurrentRoleWorkspace();
  const canCreateHorse = useCurrentRoleCapability('createHorse');
  const canUploadDocuments = useCurrentRoleCapability('uploadDocuments');
  const canManageBilling = useCurrentRoleCapability('manageBilling');
  const canManageSettings = useCurrentRoleCapability('manageSettings');
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
  const workspaceShortcuts = roleWorkspace.primaryModules
    .map((module) => ({
      label: module,
      path: workspaceShortcutRoutes[module],
    }))
    .filter((item): item is { label: string; path: string } => Boolean(item.path));
  const helpSections = routeHelp[currentLabel] ?? routeHelp.Dashboard;

  useEffect(() => {
    setHelpOpen(false);
  }, [location.pathname]);

  const handleSearch = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && search.trim()) {
      navigate(`/horses?search=${encodeURIComponent(search.trim())}`);
    }
  };

  return (
    <div className="min-h-screen bg-[#edf0f4] lg:grid lg:grid-cols-[248px,1fr]">
      <aside className="hidden min-h-screen flex-col gap-6 border-r border-white/6 bg-[#090b0d] px-5 py-5 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-[52px] w-[52px] items-center justify-center rounded-lg border border-white/8 bg-white/[0.03] p-1.5">
            <img src={`${import.meta.env.BASE_URL}xbar-logo-sleek.png`} alt="XBAR logo" className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[1.04rem] font-extrabold uppercase tracking-[0.14em]">{workspaceProfile.businessName || 'XBAR'}</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/40">{workspaceProfile.ranchName || 'Horse Ledger'}</div>
          </div>
        </div>

        <div className="rounded-xl border border-white/8 bg-[#11151a] p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/36">Workspace</div>
              <div className="mt-2 text-[0.95rem] font-semibold text-white">{roleWorkspace.label}</div>
            </div>
            <span className="inline-flex min-h-[24px] items-center rounded-md border border-[#43515d] bg-[#171d22] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#93a4b1]">
              {cloudStatus === 'signed-in' ? 'Cloud' : cloudStatus === 'unavailable' ? 'Local' : 'Limited'}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {workspaceShortcuts.map((module) => (
              <button
                key={module.label}
                type="button"
                onClick={() => navigate(module.path)}
                className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-white/72 transition-all duration-150 ease-[ease] hover:border-white/16 hover:bg-white/[0.05] hover:text-white"
              >
                {module.label}
              </button>
            ))}
          </div>
        </div>

        <NavSection title="Operations" items={operations} />
        <NavSection title="Programs" items={programs} />
        <NavSection title="Platform" items={platformItems} />

        <div className="mt-auto rounded-xl border border-white/8 bg-[#11151a] p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-white/36">Runtime</div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-white">{subscription.tier}</span>
            <Pill tone="slate">{subscription.billingState}</Pill>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-white/58">
            <div className="rounded-md border border-white/8 bg-white/[0.02] px-3 py-2">
              Seats {subscription.usage.seatsUsed}/{subscription.usage.seatLimit}
            </div>
            <div className="rounded-md border border-white/8 bg-white/[0.02] px-3 py-2">
              Docs {pendingReview} review
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col bg-[#edf0f4]">
        <header className="sticky top-0 z-10 border-b border-[#dde4eb] bg-[#f6f8fb]/95 backdrop-blur">
          <div className="flex min-h-[56px] flex-wrap items-center justify-between gap-4 px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="text-[0.96rem] font-extrabold tracking-[0.01em] text-[#202225]">{currentLabel}</div>
              <span
                className={classNames(
                  'inline-flex min-h-[24px] items-center rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]',
                  pendingReview ? 'border-[#d6dde4] bg-white text-[#52616d]' : 'border-[#d7e6dd] bg-[#f3faf6] text-[#2b6a4c]',
                )}
              >
                {pendingReview ? `${pendingReview} review` : 'Queue clear'}
              </span>
            </div>

            <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
              <label className="relative min-w-[220px] max-w-[420px] flex-1">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#7b8794]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={handleSearch}
                  placeholder="Search horses or docs"
                  className="h-10 w-full rounded-md border border-[#d5dce4] bg-white pl-10 pr-4 text-sm text-[#202225] transition-all duration-150 ease-[ease] placeholder:text-[#8a96a3] focus:border-[#8997a3] focus:outline-none"
                />
              </label>

              <div className="inline-flex h-10 items-center gap-3 rounded-md border border-[#d5dce4] bg-white px-3 text-sm font-semibold text-[#202225]">
                <span>{currentRole}</span>
                <span className={classNames('inline-flex rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]',
                  cloudStatus === 'signed-in'
                    ? 'border-[#d7e6dd] bg-[#f3faf6] text-[#2b6a4c]'
                    : cloudStatus === 'unavailable'
                      ? 'border-[#e2e5ea] bg-[#f4f5f7] text-[#667085]'
                      : 'border-[#dce5eb] bg-[#f3f7fa] text-[#405b6a]',
                )}>
                  {cloudStatus === 'signed-in' ? 'Synced' : cloudStatus === 'unavailable' ? 'Local' : 'Limited'}
                </span>
              </div>

              <button
                className="inline-flex h-10 items-center justify-center rounded-md border border-[#d5dce4] bg-white px-4 text-sm font-semibold text-[#202225] transition-all duration-150 ease-[ease] hover:border-[#c4ccd4] hover:bg-[#f7fafc]"
                type="button"
                onClick={() => setHelpOpen(true)}
              >
                Help
              </button>

              <button
                className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#d5dce4] bg-white text-[#202225] transition-all duration-150 ease-[ease] hover:border-[#c4ccd4] hover:bg-[#f7fafc] disabled:cursor-not-allowed disabled:opacity-50"
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
                className="inline-flex h-10 items-center justify-center rounded-md border border-[#d5dce4] bg-white px-4 text-sm font-semibold text-[#202225] transition-all duration-150 ease-[ease] hover:border-[#c4ccd4] hover:bg-[#f7fafc] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => navigate('/documents?upload=1')}
                disabled={!canUploadDocuments}
              >
                Intake
              </button>

              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#202225] px-4 text-sm font-semibold text-white shadow-sm transition-all duration-150 ease-[ease] hover:bg-[#151719] disabled:cursor-not-allowed disabled:opacity-50"
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

        <nav className="fixed bottom-3 left-3 right-3 z-40 grid grid-cols-5 gap-2 rounded-lg border border-white/10 bg-[#090b0d] p-2 text-white shadow-lg lg:hidden" aria-label="Mobile quick navigation">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              classNames(
                'flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-md text-[11px] font-semibold transition-all duration-150 ease-[ease]',
                isActive ? 'bg-white/[0.05] text-white' : 'text-white/72 hover:bg-white/8 hover:text-white',
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
                isActive ? 'bg-white/[0.05] text-white' : 'text-white/72 hover:bg-white/8 hover:text-white',
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
                isActive ? 'bg-white/[0.05] text-white' : 'text-white/72 hover:bg-white/8 hover:text-white',
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
                isActive ? 'bg-white/[0.05] text-white' : 'text-white/72 hover:bg-white/8 hover:text-white',
              )
            }
          >
            <SalesIcon className="h-[18px] w-[18px]" />
            <span>Sales</span>
          </NavLink>
          <button
            className="flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-md bg-[#202225] text-[11px] font-semibold text-white transition-all duration-150 ease-[ease] hover:bg-[#151719] disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={() => navigate('/horses?new=1')}
            disabled={!canCreateHorse}
          >
            <AddIcon className="h-[18px] w-[18px]" />
            <span>New</span>
          </button>
        </nav>

        <WorkspaceHelp open={helpOpen} title={currentLabel} sections={helpSections} onClose={() => setHelpOpen(false)} />
      </div>
    </div>
  );
}
