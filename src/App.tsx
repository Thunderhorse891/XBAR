import { Suspense, lazy } from 'react';
import { BrowserRouter, HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import { RequireCloudAuth } from './components/RequireCloudAuth';
import { ToastViewport } from './components/ToastViewport';

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
const SharedAccess = lazy(() => import('./routes/SharedAccess'));
const Subscriptions = lazy(() => import('./routes/Subscriptions'));

function useHashRouting() {
  if (typeof window === 'undefined') {
    return false;
  }

  return import.meta.env.VITE_ROUTER_MODE === 'hash' || window.location.hostname.endsWith('github.io');
}

export default function App() {
  const Router = useHashRouting() ? HashRouter : BrowserRouter;

  return (
    <Router>
      <ErrorBoundary>
        <ToastViewport />
        <Suspense fallback={<div className="app-loading-shell">Loading workspace...</div>}>
          <Routes>
            <Route path="/profiles/:id" element={<BuyerProfile />} />
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<RequireCloudAuth><MainLayout /></RequireCloudAuth>}>
              <Route index element={<Dashboard />} />
              <Route path="horses" element={<Horses />} />
              <Route path="horses/:id" element={<HorseDetail />} />
              <Route path="documents" element={<Documents />} />
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
