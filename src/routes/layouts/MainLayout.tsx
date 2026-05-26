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
import { useCloudStore } from '@/store/useCloudStore';
import { useUiStore } from '@/store/useUiStore';
import { useCurrentRoleCapability, useCurrentRoleWorkspace, useXbarStore } from '@/store/useXbarStore';

type NavItem = {
  label: string;
  path: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  section: 'Command' | 'Operations' | 'Platform';
  requires?: 'billing' | 'settings';
};

const brandVideoSrc = `${import.meta.env.BASE_URL}brand/xbar-documents-hero.mp4`;
const brandFallbackSrc = `${import.meta.env.BASE_URL}brand/xbar-app-icon.svg`;

const navItems: NavItem[] = [
  { label: 'Command Center', path: '/', icon: DashboardIcon, section: 'Command' },
  { label: 'Horses', path: '/horses', icon: HorsesIcon, section: 'Command' },
  { label: 'Ownership', path: '/ownership', icon: OwnershipIcon, section: 'Command' },
  { label: 'Documents', path: '/documents', icon: DocumentsIcon, section: 'Command' },
  { label: 'Health', path: '/medical', icon: MedicalIcon, section: 'Operations' },
  { label: 'Breeding', path: '/breeding', icon: BreedingIcon, section: 'Operations' },
  { label: 'Sales', path: '/sales', icon: SalesIcon, section: 'Operations' },
  { label: 'Expenses', path: '/expenses', icon: SubscriptionIcon, section: 'Operations' },
  { label: 'Reminders', path: '/reminders', icon: BellIcon, section: 'Operations' },
  { label: 'Ranch Operations', path: '/assets', icon: AssetsIcon, section: 'Operations' },
  { label: 'Weather', path: '/weather', icon: WeatherIcon, section: 'Operations' },
  { label: 'Buyer Rooms', path: '/shared-access', icon: SharedAccessIcon, section: 'Platform' },
  { label: 'Subscriptions', path: '/subscriptions', icon: SubscriptionIcon, section: 'Platform', requires: 'billing' },
  { label: 'Settings', path: '/settings', icon: SettingsIcon, section: 'Platform', requires: 'settings' },
];

const routeLabels: Record<string, string> = {
  '/': 'Command Center',
  '/horses': 'Horses',
  '/documents': 'Documents',
  '/ownership': 'Ownership',
  '/medical': 'Health',
  '/breeding': 'Breeding',
  '/sales': 'Sales',
  '/expenses': 'Expenses',
  '/reminders': 'Reminders',
  '/assets': 'Ranch Operations',
  '/weather': 'Weather',
  '/subscriptions': 'Subscriptions',
  '/shared-access': 'Buyer Rooms',
  '/settings': 'Settings',
};

const routeHelp: Record<string, HelpSection[]> = {
  'Command Center': [
    { label: 'Start here', text: 'Watch care, ownership, documents, sales, weather, and spending in one place.' },
    { label: 'Next move', text: 'Open the highest-risk card first. XBAR should tell you what needs a human decision.' },
  ],
  Horses: [
    { label: 'Profile', text: 'Each horse should become a complete command file.' },
    { label: 'Create', text: 'New horse intake should save confirmed data only.' },
  ],
  Ownership: [
    { label: 'Proof', text: 'Use this area for owners, percentages, documents, transfers, and history.' },
    { label: 'Control', text: 'No sale or transfer should move without source records.' },
  ],
  Documents: [
    { label: 'Vault', text: 'Upload first. Assign, approve, and keep the document chain clean.' },
    { label: 'Privacy', text: 'Only approved buyer-safe files should reach shared rooms.' },
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
    { label: 'Pipeline', text: 'Keep buyer movement, packet readiness, and follow-ups visible.' },
    { label: 'Buyer rooms', text: 'Share only when the horse and documents are ready.' },
  ],
  Expenses: [
    { label: 'Ledger', text: 'Log costs while the context is still fresh.' },
    { label: 'Connect', text: 'Receipts should connect to horses, care, and documents.' },
  ],
  Reminders: [
    { label: 'Queue', text: 'This is the work list for due care, papers, docs, and buyer follow-ups.' },
    { label: 'Confidence', text: 'A reminder should always show the source of the work.' },
  ],
  'Ranch Operations': [
    { label: 'Assets', text: 'Track equipment, kits, feed supply, transport, and service work.' },
    { label: 'Field use', text: 'Keep mobile actions short and readable.' },
  ],
  Weather: [
    { label: 'Forecast', text: 'Use weather for turnout, hauling, and handling windows.' },
    { label: 'Location', text: 'Set the ranch location in Settings for better daily context.' },
  ],
  Subscriptions: [
    { label: 'Billing', text: 'Show plan state clearly. Do not imply Stripe billing unless it is configured.' },
    { label: 'Limits', text: 'Storage, seats, buyer rooms, and documents should be easy to understand.' },
  ],
  'Buyer Rooms': [
    { label: 'Shares', text: 'Buyer-facing links need approved, sanitized records only.' },
    { label: 'Proof', text: 'Preview before making any horse public.' },
  ],
  Settings: [
    { label: 'Workspace', text: 'Manage defaults, members, sync, and backups.' },
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

function NavSection({ title, items }: { title: string; items: NavItem[] }) {
  return (
    <div className="xbar-nav-section">
      <div className="xbar-section-label">{title}</div>
      <div className="xbar-nav-list">
        {items.map(({ label, path, icon: Icon }) => (
          <NavLink
            key={label}
            to={path}
            end={path === '/'}
            className={({ isActive }) => classNames('xbar-nav-link', isActive && 'xbar-nav-link--active')}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </NavLink>
        ))}
      </div>
    </div>
  );
}

function MobileNavLink({ label, path, icon: Icon }: { label: string; path: string; icon: NavItem['icon'] }) {
  return (
    <NavLink
      to={path}
      end={path === '/'}
      className={({ isActive }) => classNames('xbar-mobile-link', isActive && 'xbar-mobile-link--active')}
    >
      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      <span>{label}</span>
    </NavLink>
  );
}

export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [showBrandVideo, setShowBrandVideo] = useState(true);
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
  const openWorkCount = pendingReview + pendingTransfers;
  const currentLabel = location.pathname.startsWith('/horses/') ? 'Horse Profile' : routeLabels[location.pathname] ?? 'Workspace';
  const helpSections = routeHelp[currentLabel] ?? routeHelp['Command Center'];
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
    <div className="xbar-shell">
      <div className="xbar-shell__atmosphere" aria-hidden="true">
        {showBrandVideo ? (
          <video
            className="xbar-shell__video"
            src={brandVideoSrc}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            onError={() => setShowBrandVideo(false)}
          />
        ) : null}
        <img className="xbar-shell__mark-fallback" src={brandFallbackSrc} alt="" />
      </div>

      <aside className="xbar-sidebar" aria-label="Primary navigation">
        <div className="xbar-brand">
          <div className="xbar-brand__mark">
            <XbarMark title="XBAR logo" className="h-full w-full" />
          </div>
          <div className="min-w-0">
            <div className="xbar-brand__name">{workspaceProfile.businessName || 'XBAR'}</div>
            <div className="xbar-brand__meta">Operations OS</div>
          </div>
        </div>

        <div className="xbar-status-card">
          <div className="xbar-status-label">Workspace</div>
          <div className="xbar-status-title">{workspaceProfile.ranchName || workspaceProfile.businessName || 'Primary ranch'}</div>
          <div className="xbar-status-subtitle">{roleWorkspace.label}</div>
          <div className="xbar-status-grid">
            <span className="xbar-status-stat">{horses.length} horses</span>
            <span className="xbar-status-stat">{pendingTransfers} transfers</span>
            <span className="xbar-status-stat">{pendingReview} docs</span>
            <span className="xbar-status-stat">{activeSales} buyers</span>
          </div>
          <div className="xbar-status-row">
            <span className="xbar-status-pill">{subscription.tier}</span>
            <span className="xbar-status-pill">{cloudStatus === 'signed-in' ? 'Cloud sync' : 'Browser access'}</span>
          </div>
        </div>

        <NavSection title="Command" items={sections.Command} />
        <NavSection title="Operations" items={sections.Operations} />
        <NavSection title="Platform" items={sections.Platform} />

        <div className="xbar-sidebar-footer">
          <strong>The operating system for modern horse operations.</strong>
          <span>{expenseReceipts.length} receipts | {documents.length} files</span>
        </div>
      </aside>

      <div className="xbar-main">
        <header className="xbar-topbar">
          <div className="xbar-topbar__inner">
            <div className="xbar-topbar__title">
              <div className="xbar-route-title">{currentLabel}</div>
              <span className={classNames('xbar-route-status', openWorkCount > 0 && 'xbar-route-status--open')}>
                {openWorkCount ? `${openWorkCount} open` : 'Ready'}
              </span>
            </div>

            <div className="xbar-topbar__actions">
              <label className="xbar-search">
                <SearchIcon aria-hidden="true" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={handleSearch}
                  placeholder="Search horses"
                />
              </label>

              <div className="xbar-account-chip">
                <span>{accountLabel}</span>
                <span>{cloudSession ? currentRole : 'Browser'}</span>
              </div>

              <button className="xbar-ghost-button" type="button" onClick={() => setHelpOpen(true)}>
                Help
              </button>

              {cloudSession && canSyncCloud ? (
                <button className="xbar-ghost-button" type="button" onClick={() => void handleCloudSignOut()}>
                  Sign out
                </button>
              ) : null}

              <button className="xbar-icon-button" type="button" onClick={() => navigate('/reminders')} aria-label="Open reminders">
                <BellIcon className="h-[18px] w-[18px]" />
                {openWorkCount ? <span className="xbar-alert-dot">{openWorkCount}</span> : null}
              </button>

              <button className="xbar-ghost-button" type="button" onClick={() => navigate('/documents?upload=1')} disabled={!canUploadDocuments}>
                Intake
              </button>

              <button className="xbar-primary-button" type="button" onClick={() => navigate('/horses?new=1')} disabled={!canCreateHorse}>
                <AddIcon className="h-[16px] w-[16px]" aria-hidden="true" />
                New
              </button>
            </div>
          </div>
        </header>

        <main className="xbar-content">
          <Outlet />
        </main>

        {mobileMoreOpen ? (
          <>
            <button className="xbar-mobile-scrim" type="button" aria-label="Close mobile menu" onClick={() => setMobileMoreOpen(false)} />
            <div id="mobile-more-menu" className="xbar-mobile-more-panel">
              {canCreateHorse ? (
                <button
                  className="xbar-mobile-primary"
                  type="button"
                  onClick={() => {
                    setMobileMoreOpen(false);
                    navigate('/horses?new=1');
                  }}
                >
                  <AddIcon className="h-[18px] w-[18px]" aria-hidden="true" />
                  <span>New horse</span>
                </button>
              ) : null}
              <div className="xbar-mobile-more-grid">
                {mobileMoreItems.map(({ label, path, icon: Icon }) => {
                  const isActive = path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);
                  return (
                    <button
                      key={label}
                      className={classNames('xbar-mobile-more-item', isActive && 'xbar-mobile-more-item--active')}
                      type="button"
                      onClick={() => {
                        setMobileMoreOpen(false);
                        navigate(path);
                      }}
                    >
                      <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        ) : null}

        <nav className="xbar-mobile-nav" aria-label="Mobile quick navigation">
          <MobileNavLink label="Home" path="/" icon={DashboardIcon} />
          <MobileNavLink label="Horses" path="/horses" icon={HorsesIcon} />
          <MobileNavLink label="Docs" path="/documents" icon={DocumentsIcon} />
          <MobileNavLink label="Sales" path="/sales" icon={SalesIcon} />
          <button
            className={classNames(
              'xbar-mobile-more-button',
              (mobileMoreOpen || mobileMoreItems.some((item) => location.pathname.startsWith(item.path) && item.path !== '/')) && 'xbar-mobile-more-button--active',
            )}
            type="button"
            onClick={() => setMobileMoreOpen((current) => !current)}
            aria-expanded={mobileMoreOpen}
            aria-controls="mobile-more-menu"
          >
            <DotsIcon className="h-[18px] w-[18px]" aria-hidden="true" />
            <span>More</span>
          </button>
        </nav>

        <WorkspaceHelp open={helpOpen} title={currentLabel} sections={helpSections} onClose={() => setHelpOpen(false)} />
      </div>
    </div>
  );
}
