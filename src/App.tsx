import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import { RequireCloudAuth } from './components/RequireCloudAuth';
import { RequireWorkspaceSetup } from './components/RequireWorkspaceSetup';
import { ToastViewport } from './components/ToastViewport';
import { trackRuntimeEvent } from './lib/runtimeEvents';
import { isSupabaseConfigured } from './lib/platformConfig';
import { useCloudStore } from './store/useCloudStore';
import './routes/operationsHierarchy.css';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Landing = lazy(() => import('./routes/Landing'));
const Breeding = lazy(() => import('./routes/Breeding'));
const BuyerProfile = lazy(() => import('./routes/BuyerProfile'));
const Documents = lazy(() => import('./routes/Documents'));
const Expenses = lazy(() => import('./routes/Expenses'));
const HorseDetail = lazy(() => import('./routes/HorseDetail'));
const Horses = lazy(() => import('./routes/Horses'));
const Login = lazy(() => import('./routes/Login'));
const MainLayout = lazy(() => import('./routes/layouts/MainLayout'));
const Medical = lazy(() => import('./routes/Medical'));
const NotFound = lazy(() => import('./routes/NotFound'));
const Ownership = lazy(() => import('./routes/Ownership'));
const RanchAssets = lazy(() => import('./routes/RanchAssets'));
const Reminders = lazy(() => import('./routes/Reminders'));
const Sales = lazy(() => import('./routes/Sales'));
const Settings = lazy(() => import('./routes/Settings'));
const SetupWorkspace = lazy(() => import('./routes/SetupWorkspace'));
const SharedAccess = lazy(() => import('./routes/SharedAccess'));
const Subscriptions = lazy(() => import('./routes/Subscriptions'));
const Weather = lazy(() => import('./routes/Weather'));
const Marketplace = lazy(() => import('./routes/Marketplace'));
const Terms = lazy(() => import('./routes/Terms'));
const Privacy = lazy(() => import('./routes/Privacy'));

function useHashRouting() {
  if (typeof window === 'undefined') {
    return false;
  }

  if (import.meta.env.MODE === 'e2e') {
    return false;
  }

  return import.meta.env.VITE_ROUTER_MODE === 'hash' || window.location.hostname.endsWith('github.io');
}

function routeTitle(path: string) {
  if (path.startsWith('/profiles/')) return 'XBAR | Sale Packet';
  if (path.startsWith('/horses/')) return 'XBAR | Horse Record';

  const labels: Record<string, string> = {
    '/': 'Dashboard',
    '/horses': 'Horses',
    '/documents': 'Document Vault',
    '/ownership': 'Ownership',
    '/medical': 'Health',
    '/breeding': 'Breeding',
    '/sales': 'Sales',
    '/expenses': 'Expenses',
    '/reminders': 'Reminders',
    '/assets': 'Equipment',
    '/weather': 'Weather',
    '/shared-access': 'Sale Listings',
    '/marketplace': 'Marketplace',
    '/subscriptions': 'Subscriptions',
    '/settings': 'Settings',
    '/setup': 'Setup',
    '/login': 'Login',
  };

  return `XBAR | ${labels[path] ?? 'Ranch'}`;
}

function hasCommandCenterEntry() {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem('xbar-command-center-entry') === 'true';
}

function SmartRoot() {
  const status = useCloudStore((state) => state.status);
  const session = useCloudStore((state) => state.session);

  if (hasCommandCenterEntry()) {
    return <RequireWorkspaceSetup><MainLayout /></RequireWorkspaceSetup>;
  }

  if (!isSupabaseConfigured()) {
    return <Landing />;
  }

  if (status === 'loading') {
    return <div className="app-loading-shell">Checking access...</div>;
  }

  if (!session) {
    return <Landing />;
  }

  return <RequireWorkspaceSetup><MainLayout /></RequireWorkspaceSetup>;
}

function RouteTelemetry() {
  const location = useLocation();
  const workspaceId = useCloudStore((state) => state.workspaceId);

  useEffect(() => {
    void trackRuntimeEvent({
      workspaceId: workspaceId || undefined,
      eventName: 'navigation.page_view',
      severity: 'info',
      payload: {
        pathname: location.pathname,
        search: location.search,
      },
    });
  }, [location.pathname, location.search, workspaceId]);

  useEffect(() => {
    document.title = routeTitle(location.pathname);
  }, [location.pathname]);

  return null;
}

export default function App() {
  const Router = useHashRouting() ? HashRouter : BrowserRouter;

  return (
    <Router>
      <ErrorBoundary>
        <ToastViewport />
        <RouteTelemetry />
        <Suspense fallback={<div className="app-loading-shell">Loading...</div>}>
          <Routes>
            <Route path="/profiles/:id" element={<BuyerProfile />} />
            <Route path="/login" element={<Login />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/setup" element={<RequireCloudAuth><SetupWorkspace /></RequireCloudAuth>} />
            <Route path="/" element={<SmartRoot />}>
              <Route index element={<Dashboard />} />
              <Route path="horses" element={<Horses />} />
              <Route path="horses/:id" element={<HorseDetail />} />
              <Route path="documents" element={<Documents />} />
              <Route path="weather" element={<Weather />} />
              <Route path="ownership" element={<Ownership />} />
              <Route path="medical" element={<Medical />} />
              <Route path="breeding" element={<Breeding />} />
              <Route path="sales" element={<Sales />} />
              <Route path="expenses" element={<Expenses />} />
              <Route path="reminders" element={<Reminders />} />
              <Route path="assets" element={<RanchAssets />} />
              <Route path="subscriptions" element={<Subscriptions />} />
              <Route path="shared-access" element={<SharedAccess />} />
              <Route path="marketplace" element={<Marketplace />} />
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
