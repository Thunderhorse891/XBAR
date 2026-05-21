import type { ComponentType, KeyboardEvent, SVGProps } from 'react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
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
  WeatherIcon,
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
  { label: 'Weather', path: '/weather', icon: WeatherIcon },
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
  '/weather': 'Weather',
  '/ownership': 'Ownership',
  '/medical': 'Medical',
  '/breeding': 'Breeding',
  '/sales': 'Sales',
  '/assets': 'Ranch Toolkit',
  '/subscriptions': 'Subscriptions',
  '/shared-access': 'Shared Access',
  '/settings': 'Settings',
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
  Weather: [
    { label: 'Forecast', text: 'Use ranch weather to plan turnout, hauling, and handling windows.' },
    { label: 'Actions', text: 'Search any location or use current position for a live forecast.' },
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
      <div className="px-3 text-[10px] font-semibold uppercase tracking-[0.28em] text-[#8693a1]">{title}</div>
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
                  ? 'border-[#0c6f97] bg-white text-[#16202b] shadow-[0_10px_24px_rgba(15,23,42,0.04)]'
                  : 'border-transparent text-[#64707d] hover:border-[#d9e2eb] hover:bg-white hover:text-[#16202b]',
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
  const helpSections = routeHelp[currentLabel] ?? routeHelp.Dashboard;
  const accountLabel = cloudSession?.user?.email ?? currentRole;

  useEffect(() => {
    setHelpOpen(false);
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
      <div className="min-h-screen bg-[#f6f8fb] lg:grid lg:grid-cols-[236px,1fr]">
      <aside className="hidden min-h-screen flex-col gap-6 border-r border-[#dde5ee] bg-[#fbfdff] px-5 py-6 text-[#16202b] lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-[52px] w-[52px] items-center justify-center rounded-lg border border-[#dbe4ed] bg-white p-1.5 shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
            <img src={`${import.meta.env.BASE_URL}xbar-logo-sleek.png`} alt="XBAR logo" className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[1.04rem] font-extrabold uppercase tracking-[0.14em]">{workspaceProfile.businessName || 'XBAR'}</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#8a96a4]">{workspaceProfile.ranchName || 'Horse Ledger'}</div>
          </div>
        </div>

        <div className="rounded-[18px] border border-[#dbe4ed] bg-white p-4 shadow-[0_12px_24px_rgba(15,23,42,0.04)]">
          <div className="text-[10px] font-semibold uppercase tracking-[0.28em] text-[#8794a2]">Workspace</div>
          <div className="mt-2 text-[1rem] font-bold tracking-[-0.03em] text-[#16202b]">
            {workspaceProfile.ranchName || workspaceProfile.businessName || 'Primary ranch'}
          </div>
          <div className="mt-1 text-sm text-[#667482]">{roleWorkspace.label}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="inline-flex min-h-[28px] items-center rounded-full border border-[#dbe4ed] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#4b5a69]">
              {subscription.tier}
            </span>
            <span className="inline-flex min-h-[28px] items-center rounded-full border border-[#d7e8ef] bg-[#edf6fa] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#0c6f97]">
              {cloudStatus === 'signed-in' ? 'Cloud sync' : 'Browser access'}
            </span>
            {pendingReview ? (
              <span className="inline-flex min-h-[28px] items-center rounded-full border border-[#dbe4ed] bg-[#f4f8fb] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-[#627181]">
                {pendingReview} review
              </span>
            ) : null}
          </div>
          <div className="mt-4 text-xs leading-6 text-[#6a7178]">Use the navigation below for every workspace route. Settings and shared access stay in the Platform section.</div>
        </div>

        <NavSection title="Operations" items={operations} />
        <NavSection title="Programs" items={programs} />
        <NavSection title="Platform" items={platformItems} />

        <div className="mt-auto border-t border-[#dde5ee] pt-4 text-xs text-[#8794a2]">
          <div className="font-semibold text-[#5f6c79]">{workspaceProfile.businessName || 'XBAR'}</div>
          <div className="mt-1">{subscription.tier} plan</div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col bg-[#f6f8fb]">
        <header className="sticky top-0 z-10 border-b border-[#dde5ee] bg-[#fbfdff]/90 backdrop-blur">
          <div className="flex min-h-[56px] flex-wrap items-center justify-between gap-4 px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="text-[0.96rem] font-extrabold tracking-[0.01em] text-[#16202b]">{currentLabel}</div>
              <span
                className={classNames(
                  'inline-flex min-h-[24px] items-center rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]',
                  pendingReview ? 'border-[#dbe4ed] bg-[#f4f8fb] text-[#627181]' : 'border-[#d7e8ef] bg-[#edf6fa] text-[#0c6f97]',
                )}
              >
                {pendingReview ? `${pendingReview} review` : 'Ready'}
              </span>
            </div>

            <div className="flex flex-1 flex-wrap items-center justify-end gap-3">
              <label className="relative min-w-[220px] max-w-[420px] flex-1">
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#7d8389]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={handleSearch}
                  placeholder="Search"
                className="h-10 w-full rounded-md border border-[#dde5ee] bg-white pl-10 pr-4 text-sm text-[#16202b] transition-all duration-150 ease-[ease] placeholder:text-[#8f959c] focus:border-[#0c6f97] focus:outline-none"
                />
              </label>

              <div className="inline-flex h-10 items-center gap-3 rounded-md border border-[#dde5ee] bg-white px-3 text-sm font-semibold text-[#16202b]">
                <span className="max-w-[190px] truncate">{accountLabel}</span>
                <span className={classNames('inline-flex rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em]',
                  cloudStatus === 'signed-in'
                    ? 'border-[#d7e8ef] bg-[#edf6fa] text-[#0c6f97]'
                    : cloudStatus === 'unavailable'
                      ? 'border-[#d8e1ea] bg-[#eef3f8] text-[#607384]'
                      : 'border-[#d8e1ea] bg-[#eef3f8] text-[#607384]',
                )}>
                  {cloudSession ? currentRole : 'Browser'}
                </span>
              </div>

              <button
                className="inline-flex h-10 items-center justify-center rounded-md border border-[#dde5ee] bg-white px-4 text-sm font-semibold text-[#16202b] transition-all duration-150 ease-[ease] hover:border-[#0c6f97] hover:bg-[#eef6fb]"
                type="button"
                onClick={() => setHelpOpen(true)}
              >
                Help
              </button>

              {cloudSession && canSyncCloud ? (
                <button
                  className="inline-flex h-10 items-center justify-center rounded-md border border-[#dde5ee] bg-white px-4 text-sm font-semibold text-[#16202b] transition-all duration-150 ease-[ease] hover:border-[#0c6f97] hover:bg-[#eef6fb]"
                  type="button"
                  onClick={() => void handleCloudSignOut()}
                >
                  Sign out
                </button>
              ) : null}

              <button
                className="relative inline-flex h-10 w-10 items-center justify-center rounded-md border border-[#dde5ee] bg-white text-[#16202b] transition-all duration-150 ease-[ease] hover:border-[#0c6f97] hover:bg-[#eef6fb] disabled:cursor-not-allowed disabled:opacity-50"
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
                className="inline-flex h-10 items-center justify-center rounded-md border border-[#dde5ee] bg-white px-4 text-sm font-semibold text-[#16202b] transition-all duration-150 ease-[ease] hover:border-[#0c6f97] hover:bg-[#eef6fb] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => navigate('/documents?upload=1')}
                disabled={!canUploadDocuments}
              >
                Intake
              </button>

              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[#0c6f97] px-4 text-sm font-semibold text-white shadow-sm transition-all duration-150 ease-[ease] hover:bg-[#095a7a] disabled:cursor-not-allowed disabled:opacity-50"
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

        <main className="flex flex-col gap-[20px] px-6 py-5">
          <Outlet />
        </main>

        <nav className="fixed bottom-3 left-3 right-3 z-40 grid grid-cols-5 gap-2 rounded-lg border border-[#dde5ee] bg-[#fbfdff] p-2 text-[#16202b] shadow-lg lg:hidden" aria-label="Mobile quick navigation">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              classNames(
                'flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-md text-[11px] font-semibold transition-all duration-150 ease-[ease]',
                isActive ? 'bg-[#edf6fa] text-[#0c6f97]' : 'text-[#798088] hover:bg-white hover:text-[#16202b]',
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
                isActive ? 'bg-[#edf6fa] text-[#0c6f97]' : 'text-[#798088] hover:bg-white hover:text-[#16202b]',
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
                isActive ? 'bg-[#edf6fa] text-[#0c6f97]' : 'text-[#798088] hover:bg-white hover:text-[#16202b]',
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
                isActive ? 'bg-[#edf6fa] text-[#0c6f97]' : 'text-[#798088] hover:bg-white hover:text-[#16202b]',
              )
            }
          >
            <SalesIcon className="h-[18px] w-[18px]" />
            <span>Sales</span>
          </NavLink>
          <button
            className="flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-md bg-[#0c6f97] text-[11px] font-semibold text-white transition-all duration-150 ease-[ease] hover:bg-[#095a7a] disabled:cursor-not-allowed disabled:opacity-50"
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
