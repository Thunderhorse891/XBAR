import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import { RequireCloudAuth } from './components/RequireCloudAuth';
import { RequireSharedListings } from './components/RequireSubscriptionFeature';
import { RequireWorkspaceSetup } from './components/RequireWorkspaceSetup';
import { SubscriptionEnforcement } from './components/SubscriptionEnforcement';
import { InteractionShell } from './components/InteractionSystem';
import { Toaster } from './components/ui/sonner';
import { trackRuntimeEvent } from './lib/runtimeEvents';
import { useCloudStore } from './store/useCloudStore';
import { useWorkspaceHydrated, useWorkspaceReady } from './store/useXbarStore';
import './routes/operationsHierarchy.css';
import './routes/interactionSystem.css';
import './routes/xbarCommandSystem.css';
import './routes/metalBrandSystem.css';
import './routes/commandCenterLocal.css';
import './routes/premiumOperatingSystem.css';
import './routes/premiumSaasExperience.css';
import './routes/productionFinal.css';
import './routes/stitchDesignSystem.css';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Breeding = lazy(() => import('./routes/Breeding'));
const BuyerProfile = lazy(() => import('./routes/BuyerProfile'));
const DocumentLibrary = lazy(() => import('./routes/DocumentLibrary'));
const Documents = lazy(() => import('./routes/Documents'));
const Expenses = lazy(() => import('./routes/Expenses'));
const FollowUps = lazy(() => import('./routes/FollowUps'));
const HorseDetail = lazy(() => import('./routes/HorseDetail'));
const Horses = lazy(() => import('./routes/Horses'));
const Landing = lazy(() => import('./routes/Landing'));
const Login = lazy(() => import('./routes/Login'));
const MainLayout = lazy(() => import('./routes/layouts/MainLayout'));
const Medical = lazy(() => import('./routes/Medical'));
const NotFound = lazy(() => import('./routes/NotFound'));
const Ownership = lazy(() => import('./routes/Ownership'));
const Privacy = lazy(() => import('./routes/Privacy'));
const RanchAssets = lazy(() => import('./routes/RanchAssets'));
const Reminders = lazy(() => import('./routes/Reminders'));
const Sales = lazy(() => import('./routes/Sales'));
const Settings = lazy(() => import('./routes/Settings'));
const SetupWorkspace = lazy(() => import('./routes/SetupWorkspace'));
const SharedAccess = lazy(() => import('./routes/SharedAccess'));
const Subscriptions = lazy(() => import('./routes/Subscriptions'));
const Terms = lazy(() => import('./routes/Terms'));
const Weather = lazy(() => import('./routes/Weather'));

const ROUTE_LABELS: Record<string, string> = {
  '/': 'Home',
  '/assets': 'Equipment',
  '/breeding': 'Breeding',
  '/document-library': 'Document Library',
  '/documents': 'Documents',
  '/expenses': 'Expenses',
  '/follow-ups': 'Buyer Follow-ups',
  '/horses': 'Horses',
  '/landing': 'Ranch Platform',
  '/login': 'Login',
  '/medical': 'Health',
  '/ownership': 'Ownership',
  '/reminders': 'Reminders',
  '/sales': 'Sales',
  '/settings': 'Settings',
  '/setup': 'Setup',
  '/shared-access': 'Listings',
  '/subscribe': 'Choose Plan',
  '/subscriptions': 'Plan & Billing',
  '/weather': 'Weather',
};

function useHashRouting() {
  if (typeof window === 'undefined' || import.meta.env.MODE === 'e2e') return false;
  return import.meta.env.VITE_ROUTER_MODE === 'hash' || window.location.hostname.endsWith('github.io');
}

function routeTitle(path: string) {
  if (path.startsWith('/profiles/')) return 'XBAR | Listings';
  if (path.startsWith('/horses/')) return 'XBAR | Horse';
  return `XBAR | ${ROUTE_LABELS[path] ?? 'Ranch'}`;
}

const DEFAULT_META_DESCRIPTION =
  'XBAR turns scattered horse paperwork into trusted, buyer-ready digital records — OCR-assisted intake, ownership integrity, compliance deadlines, and watermarked sale packets in one command system.';

// Distinct titles and descriptions for the publicly indexable routes. These
// compound the static SEO in index.html so each crawlable page presents its
// own snippet in search and social results instead of the shared default.
const PUBLIC_ROUTE_META: Record<string, { title: string; description: string }> = {
  '/': {
    title: 'Sign in to XBAR',
    description:
      'Sign in to XBAR to manage horse records, ownership, documents, and sale-ready buyer packets.',
  },
  '/landing': {
    title: 'XBAR — Clean records, ownership integrity, faster sale readiness',
    description: DEFAULT_META_DESCRIPTION,
  },
  '/login': {
    title: 'Sign in or create your workspace | XBAR',
    description:
      'Sign in to XBAR or create a local-first workspace for horse records, ownership, documents, and sale-ready buyer packets.',
  },
  '/privacy': {
    title: 'Privacy Policy | XBAR',
    description: 'How XBAR handles workspace data, document storage, and account information.',
  },
  '/terms': {
    title: 'Terms of Service | XBAR',
    description: 'The terms that govern use of the XBAR equine operations platform.',
  },
};

function setMetaDescription(content: string) {
  if (typeof document === 'undefined') return;
  let tag = document.querySelector('meta[name="description"]');
  if (!tag) {
    tag = document.createElement('meta');
    tag.setAttribute('name', 'description');
    document.head.appendChild(tag);
  }
  tag.setAttribute('content', content);
}

function applyRouteMeta(path: string) {
  if (typeof document === 'undefined') return;
  const meta = PUBLIC_ROUTE_META[path];
  document.title = meta ? meta.title : routeTitle(path);
  setMetaDescription(meta ? meta.description : DEFAULT_META_DESCRIPTION);
}

function RouteTelemetry() {
  const location = useLocation();
  const workspaceId = useCloudStore((state) => state.workspaceId);

  useEffect(() => {
    void trackRuntimeEvent({
      workspaceId: workspaceId || undefined,
      eventName: 'navigation.page_view',
      severity: 'info',
      payload: { pathname: location.pathname, search: location.search },
    });
  }, [location.pathname, location.search, workspaceId]);

  useEffect(() => {
    applyRouteMeta(location.pathname);
  }, [location.pathname]);

  return null;
}

function hasCommandCenterEntry() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem('xbar-command-center-entry') === 'true';
}

function AppHomeGate() {
  const location = useLocation();
  const session = useCloudStore((state) => state.session);
  const workspaceHydrated = useWorkspaceHydrated();
  const workspaceReady = useWorkspaceReady();

  if (location.pathname === '/' && !session && !hasCommandCenterEntry()) {
    if (!workspaceHydrated) return <div className="app-loading-shell">Loading XBAR...</div>;
    if (!workspaceReady) return <Login />;
  }

  return (
    <RequireCloudAuth>
      <RequireWorkspaceSetup>
        <MainLayout />
      </RequireWorkspaceSetup>
    </RequireCloudAuth>
  );
}

export default function App() {
  const Router = useHashRouting() ? HashRouter : BrowserRouter;

  return (
    <Router>
      <ErrorBoundary>
        <Toaster position="top-right" richColors closeButton />
        <InteractionShell />
        <SubscriptionEnforcement />
        <RouteTelemetry />
        <Suspense fallback={<div className="app-loading-shell">Loading XBAR...</div>}>
          <Routes>
            <Route path="/profiles/:id" element={<BuyerProfile />} />
            <Route path="/landing" element={<Landing />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/login" element={<Login />} />
            <Route path="/subscribe" element={<RequireCloudAuth><Subscriptions /></RequireCloudAuth>} />
            <Route path="/setup" element={<RequireCloudAuth><SetupWorkspace /></RequireCloudAuth>} />
            <Route path="/" element={<AppHomeGate />}>
              <Route index element={<Dashboard />} />
              <Route path="horses" element={<Horses />} />
              <Route path="horses/:id" element={<HorseDetail />} />
              <Route path="documents" element={<Documents />} />
              <Route path="document-library" element={<DocumentLibrary />} />
              <Route path="weather" element={<Weather />} />
              <Route path="ownership" element={<Ownership />} />
              <Route path="medical" element={<Medical />} />
              <Route path="breeding" element={<Breeding />} />
              <Route path="sales" element={<Sales />} />
              <Route path="follow-ups" element={<FollowUps />} />
              <Route path="expenses" element={<Expenses />} />
              <Route path="reminders" element={<Reminders />} />
              <Route path="assets" element={<RanchAssets />} />
              <Route path="subscriptions" element={<Subscriptions />} />
              <Route path="shared-access" element={<RequireSharedListings><SharedAccess /></RequireSharedListings>} />
              <Route path="settings" element={<Settings />} />
              <Route path="*" element={<NotFound />} />
            </Route>
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </Router>
  );
}
