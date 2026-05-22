import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import { RequireCloudAuth } from './components/RequireCloudAuth';
import { RequireWorkspaceSetup } from './components/RequireWorkspaceSetup';
import { ToastViewport } from './components/ToastViewport';
import { trackRuntimeEvent } from './lib/runtimeEvents';
import { useCloudStore } from './store/useCloudStore';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Breeding = lazy(() => import('./routes/Breeding'));
const BuyerProfile = lazy(() => import('./routes/BuyerProfile'));
const Documents = lazy(() => import('./routes/Documents'));
const HorseDetail = lazy(() => import('./routes/HorseDetail'));
const Horses = lazy(() => import('./routes/Horses'));
const Login = lazy(() => import('./routes/Login'));
const MainLayout = lazy(() => import('./routes/layouts/MainLayout'));
const Medical = lazy(() => import('./routes/Medical'));
const NotFound = lazy(() => import('./routes/NotFound'));
const Ownership = lazy(() => import('./routes/Ownership'));
const RanchAssets = lazy(() => import('./routes/RanchAssets'));
const Sales = lazy(() => import('./routes/Sales'));
const Settings = lazy(() => import('./routes/Settings'));
const SetupWorkspace = lazy(() => import('./routes/SetupWorkspace'));
const SharedAccess = lazy(() => import('./routes/SharedAccess'));
const Subscriptions = lazy(() => import('./routes/Subscriptions'));
const Weather = lazy(() => import('./routes/Weather'));

function useHashRouting() {
  if (typeof window === 'undefined') {
    return false;
  }

  if (import.meta.env.MODE === 'e2e') {
    return false;
  }

  return import.meta.env.VITE_ROUTER_MODE === 'hash' || window.location.hostname.endsWith('github.io');
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

  return null;
}

export default function App() {
  const Router = useHashRouting() ? HashRouter : BrowserRouter;

  return (
    <Router>
      <ErrorBoundary>
        <ToastViewport />
        <RouteTelemetry />
        <Suspense fallback={<div className="app-loading-shell">Loading workspace...</div>}>
          <Routes>
            <Route path="/profiles/:id" element={<BuyerProfile />} />
            <Route path="/login" element={<Login />} />
            <Route path="/setup" element={<RequireCloudAuth><SetupWorkspace /></RequireCloudAuth>} />
            <Route path="/" element={<RequireCloudAuth><RequireWorkspaceSetup><MainLayout /></RequireWorkspaceSetup></RequireCloudAuth>}>
              <Route index element={<Dashboard />} />
              <Route path="horses" element={<Horses />} />
              <Route path="horses/:id" element={<HorseDetail />} />
              <Route path="documents" element={<Documents />} />
              <Route path="weather" element={<Weather />} />
              <Route path="ownership" element={<Ownership />} />
              <Route path="medical" element={<Medical />} />
              <Route path="breeding" element={<Breeding />} />
              <Route path="sales" element={<Sales />} />
              <Route path="assets" element={<RanchAssets />} />
              <Route path="subscriptions" element={<Subscriptions />} />
              <Route path="shared-access" element={<SharedAccess />} />
              <Route path="portal" element={<Navigate to="/shared-access" replace />} />
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
