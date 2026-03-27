import type { ComponentType, KeyboardEvent, SVGProps } from 'react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Pill } from '@/components/app-ui';
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
import { useCurrentRoleCapability, useCurrentRoleWorkspace, useXbarStore } from '@/store/useXbarStore';
import type { UserRole } from '@/types/xbar';

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

function classNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function NavSection({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="px-3 text-[10px] font-semibold uppercase tracking-[0.24em] text-[#666666]">{title}</div>
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
                  ? 'border-[#066B90] bg-[#E8F2F7] text-[#03375D]'
                  : 'border-transparent text-white/78 hover:border-[#066B90]/35 hover:bg-white/5 hover:text-white',
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
  const currentRole = useXbarStore((state) => state.currentRole);
  const setCurrentRole = useXbarStore((state) => state.setCurrentRole);
  const subscription = useXbarStore((state) => state.subscription);
  const documents = useXbarStore((state) => state.documents);
  const workspaceProfile = useXbarStore((state) => state.workspaceProfile);
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

  const handleSearch = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && search.trim()) {
      navigate(`/horses?search=${encodeURIComponent(search.trim())}`);
    }
  };

  return (
    <div className="min-h-screen bg-[#f2f2f7] lg:grid lg:grid-cols-[276px,1fr]">
      <aside className="hidden min-h-screen flex-col gap-5 border-r border-white/10 bg-[#03375D] px-[18px] py-6 text-white lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-[52px] w-[52px] items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-1.5">
            <img src={`${import.meta.env.BASE_URL}xbar-logo-sleek.png`} alt="XBAR logo" className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[1.04rem] font-extrabold uppercase tracking-[0.14em]">{workspaceProfile.businessName || 'XBAR'}</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-white/55">{workspaceProfile.ranchName || 'Horse Ledger'}</div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/8 bg-white/5 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#8bb9d2]">Workspace</div>
          <div className="mt-2 text-sm font-semibold text-white">{roleWorkspace.label}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            {roleWorkspace.primaryModules.map((module) => (
              <span key={module} className="rounded-full bg-[#E8F2F7] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#4A90B8]">
                {module}
              </span>
            ))}
          </div>
        </div>

        <NavSection title="Operations" items={operations} />
        <NavSection title="Programs" items={programs} />
        <NavSection title="Platform" items={platformItems} />

        <div className="mt-auto rounded-2xl border border-white/8 bg-white/5 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#8bb9d2]">Contract</div>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-white">{subscription.tier}</span>
            <Pill tone="blue">{subscription.billingState}</Pill>
          </div>
          <div className="mt-2 text-xs text-white/62">
            {subscription.usage.seatsUsed}/{subscription.usage.seatLimit} seats in use
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col bg-[#f2f2f7]">
        <header className="sticky top-0 z-10 border-b border-[#d8e0e8] bg-white/95 backdrop-blur-sm">
          <div className="flex min-h-[58px] flex-wrap items-center justify-between gap-4 px-5 py-3">
            <div className="flex items-center gap-3">
              <div className="text-[0.92rem] font-extrabold tracking-[0.01em] text-[#202225]">{currentLabel}</div>
              <span
                className={classNames(
                  'inline-flex min-h-[24px] items-center rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]',
                  pendingReview ? 'bg-[#E8F2F7] text-[#066B90]' : 'bg-emerald-50 text-emerald-700',
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
                  placeholder="Search records"
                  className="h-10 w-full rounded-full border border-[#d1dbe4] bg-white pl-10 pr-4 text-sm text-[#202225] transition-all duration-150 ease-[ease] placeholder:text-[#8a96a3] focus:border-[#066B90] focus:outline-none"
                />
              </label>

              <select
                className="h-10 rounded-full border border-[#d1dbe4] bg-white px-4 text-sm font-medium text-[#202225] transition-all duration-150 ease-[ease] focus:border-[#066B90] focus:outline-none"
                value={currentRole}
                onChange={(event) => setCurrentRole(event.target.value as UserRole)}
                aria-label="Workspace role"
              >
                <option value="Admin">Admin</option>
                <option value="Ranch Manager">Ranch Manager</option>
                <option value="Owner">Owner</option>
                <option value="Medical Lead">Medical Lead</option>
                <option value="Sales Lead">Sales Lead</option>
              </select>

              <button
                className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-[#d1dbe4] bg-white text-[#202225] transition-all duration-150 ease-[ease] hover:border-[#4A90B8]/50 hover:bg-[#f7fafc] disabled:cursor-not-allowed disabled:opacity-50"
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
                className="inline-flex h-10 items-center justify-center rounded-full border border-[#d1dbe4] bg-white px-4 text-sm font-semibold text-[#202225] transition-all duration-150 ease-[ease] hover:border-[#4A90B8]/50 hover:bg-[#f7fafc] disabled:cursor-not-allowed disabled:opacity-50"
                type="button"
                onClick={() => navigate('/documents?upload=1')}
                disabled={!canUploadDocuments}
              >
                Intake
              </button>

              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[#066B90] px-4 text-sm font-semibold text-white shadow-sm transition-all duration-150 ease-[ease] hover:bg-[#055a7a] disabled:cursor-not-allowed disabled:opacity-50"
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

        <nav className="fixed bottom-3 left-3 right-3 z-40 grid grid-cols-5 gap-2 rounded-2xl border border-white/10 bg-[#03375D] p-2 text-white shadow-lg lg:hidden" aria-label="Mobile quick navigation">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              classNames(
                'flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition-all duration-150 ease-[ease]',
                isActive ? 'bg-[#E8F2F7] text-[#03375D]' : 'text-white/72 hover:bg-white/8 hover:text-white',
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
                'flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition-all duration-150 ease-[ease]',
                isActive ? 'bg-[#E8F2F7] text-[#03375D]' : 'text-white/72 hover:bg-white/8 hover:text-white',
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
                'flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition-all duration-150 ease-[ease]',
                isActive ? 'bg-[#E8F2F7] text-[#03375D]' : 'text-white/72 hover:bg-white/8 hover:text-white',
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
                'flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold transition-all duration-150 ease-[ease]',
                isActive ? 'bg-[#E8F2F7] text-[#03375D]' : 'text-white/72 hover:bg-white/8 hover:text-white',
              )
            }
          >
            <SalesIcon className="h-[18px] w-[18px]" />
            <span>Sales</span>
          </NavLink>
          <button
            className="flex min-h-[62px] flex-col items-center justify-center gap-1 rounded-xl bg-[#066B90] text-[11px] font-semibold text-white transition-all duration-150 ease-[ease] hover:bg-[#055a7a] disabled:cursor-not-allowed disabled:opacity-50"
            type="button"
            onClick={() => navigate('/horses?new=1')}
            disabled={!canCreateHorse}
          >
            <AddIcon className="h-[18px] w-[18px]" />
            <span>New</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
