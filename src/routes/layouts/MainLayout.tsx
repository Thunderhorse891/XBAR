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
  PortalIcon,
  SalesIcon,
  SearchIcon,
  SettingsIcon,
  SubscriptionIcon,
} from '@/components/icons';
import { useCurrentRoleWorkspace, useXbarStore } from '@/store/useXbarStore';
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
  { label: 'Shared Access', path: '/portal', icon: PortalIcon },
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
  '/portal': 'Shared Access',
  '/settings': 'Settings',
};

function NavSection({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <div className="nav-section">
      <div className="nav-section__title">{title}</div>
      <div className="nav-section__items">
        {items.map(({ label, path, icon: Icon }) => (
          <NavLink key={label} to={path} end={path === '/'} className={({ isActive }) => `nav-link${isActive ? ' nav-link--active' : ''}`}>
            <Icon className="nav-link__icon" />
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
  const roleWorkspace = useCurrentRoleWorkspace();

  const pendingReview = documents.filter((document) => document.state === 'Needs Review' || document.state === 'Matched').length;
  const currentLabel = location.pathname.startsWith('/horses/') ? 'Horse Profile' : routeLabels[location.pathname] ?? 'Dashboard';

  const handleSearch = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && search.trim()) {
      navigate(`/horses?search=${encodeURIComponent(search.trim())}`);
    }
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-lockup__mark">
            <img src={`${import.meta.env.BASE_URL}xbar-logo-sleek.png`} alt="XBAR logo" />
          </div>
          <div>
            <div className="brand-lockup__title">XBAR</div>
            <div className="brand-lockup__subtitle">Horse Ledger</div>
          </div>
        </div>

        <div className="sidebar-card">
          <div className="sidebar-card__eyebrow">Workspace</div>
          <div className="sidebar-card__title">{roleWorkspace.label}</div>
          <div className="sidebar-card__tags">
            {roleWorkspace.primaryModules.map((module) => (
              <Pill key={module}>{module}</Pill>
            ))}
          </div>
        </div>

        <NavSection title="Operations" items={operations} />
        <NavSection title="Programs" items={programs} />
        <NavSection title="Platform" items={platform} />

        <div className="sidebar-footer">
          <div className="sidebar-footer__title">Contract status</div>
          <div className="sidebar-footer__row">
            <span>{subscription.tier}</span>
            <Pill tone="blue">{subscription.billingState}</Pill>
          </div>
          <div className="sidebar-footer__meta">
            {subscription.usage.seatsUsed}/{subscription.usage.seatLimit} seats in use
          </div>
        </div>
      </aside>

      <div className="shell-main">
        <header className="topbar">
          <div className="topbar__context">
            <div className="topbar__title-row">
              <div className="topbar__title">{currentLabel}</div>
              <Pill tone={pendingReview ? 'amber' : 'emerald'}>{pendingReview ? `${pendingReview} in review` : 'Queue clear'}</Pill>
            </div>
          </div>

          <div className="topbar__controls">
            <label className="search-shell">
              <SearchIcon className="search-shell__icon" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={handleSearch}
                placeholder="Search records"
                className="search-shell__input"
              />
            </label>

            <select
              className="role-select"
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

            <button className="icon-button" type="button" onClick={() => navigate('/documents')} aria-label="Open document review">
              <BellIcon className="icon-button__icon" />
              {pendingReview ? <span className="icon-button__dot">{pendingReview}</span> : null}
            </button>

            <button className="button button--ghost" type="button" onClick={() => navigate('/documents?upload=1')}>
              Intake
            </button>

            <button className="button button--primary" type="button" onClick={() => navigate('/horses?new=1')}>
              <AddIcon className="button__icon" />
              New
            </button>
          </div>
        </header>

        <main className="shell-content">
          <Outlet />
        </main>

        <nav className="mobile-dock" aria-label="Mobile quick navigation">
          <NavLink to="/" end className={({ isActive }) => `mobile-dock__item${isActive ? ' mobile-dock__item--active' : ''}`}>
            <DashboardIcon className="mobile-dock__icon" />
            <span>Home</span>
          </NavLink>
          <NavLink to="/horses" className={({ isActive }) => `mobile-dock__item${isActive ? ' mobile-dock__item--active' : ''}`}>
            <HorsesIcon className="mobile-dock__icon" />
            <span>Horses</span>
          </NavLink>
          <NavLink to="/documents" className={({ isActive }) => `mobile-dock__item${isActive ? ' mobile-dock__item--active' : ''}`}>
            <DocumentsIcon className="mobile-dock__icon" />
            <span>Docs</span>
          </NavLink>
          <NavLink to="/sales" className={({ isActive }) => `mobile-dock__item${isActive ? ' mobile-dock__item--active' : ''}`}>
            <SalesIcon className="mobile-dock__icon" />
            <span>Sales</span>
          </NavLink>
          <button className="mobile-dock__item mobile-dock__item--action" type="button" onClick={() => navigate('/horses?new=1')}>
            <AddIcon className="mobile-dock__icon" />
            <span>New</span>
          </button>
        </nav>
      </div>
    </div>
  );
}
