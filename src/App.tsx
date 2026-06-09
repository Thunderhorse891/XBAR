import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ActivationGuide } from './components/ActivationGuide';
import { BuyerMomentum } from './components/BuyerMomentum';
import ErrorBoundary from './components/ErrorBoundary';
import { OperationalValuePulseConnected } from './components/OperationalValuePulseConnected';
import { RequireCloudAuth } from './components/RequireCloudAuth';
import { RequireSharedListings } from './components/RequireSubscriptionFeature';
import { RequireWorkspaceSetup } from './components/RequireWorkspaceSetup';
import { SubscriptionEnforcement } from './components/SubscriptionEnforcement';
import { ToastViewport } from './components/ToastViewport';
import { InteractionShell } from './components/InteractionSystem';
import { trackRuntimeEvent } from './lib/runtimeEvents';
import { useCloudStore } from './store/useCloudStore';
import './routes/operationsHierarchy.css';
import './routes/interactionSystem.css';
import './routes/xbarCommandSystem.css';
import './routes/metalBrandSystem.css';

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
  '/': 'Dashboard',
  '/assets': 'Equipment',
  '/breeding': 'Breeding',
  '/document-library': 'Document Library',
  '/documents': 'Document Vault',
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
  '/shared-access': 'Sale Listings',
  '/subscriptions': 'Subscriptions',
  '/weather': 'Weather',
};

function useHashRouting() {
  if (typeof window === 'undefined' || import.meta.env.MODE === 'e2e') return false;
  return import.meta.env.VITE_ROUTER_MODE === 'hash' || window.location.hostname.endsWith('github.io');
}

function routeTitle(path: string) {
  if (path.startsWith('/profiles/')) return 'XBAR | Sale Packet';
  if (path.startsWith('/horses/')) return 'XBAR | Horse Record';
  return `XBAR | ${ROUTE_LABELS[path] ?? 'Ranch'}`;
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
    document.title = routeTitle(location.pathname);
  }, [location.pathname]);

  return null;
}

function DashboardWithActivation() {
  return (
    <>
      <ActivationGuide />
      <BuyerMomentum />
      <OperationalValuePulseConnected />
      <Dashboard />
    </>
  );
}

export default function App() {
  const Router = useHashRouting() ? HashRouter : BrowserRouter;

  return (
    <Router>
      <ErrorBoundary>
        <ToastViewport />
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
            <Route path="/setup" element={<RequireCloudAuth><SetupWorkspace /></RequireCloudAuth>} />
            <Route path="/" element={<RequireCloudAuth><RequireWorkspaceSetup><MainLayout /></RequireWorkspaceSetup></RequireCloudAuth>}>
              <Route index element={<DashboardWithActivation />} />
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
