import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import { ToastViewport } from './components/ToastViewport';
import Dashboard from './pages/Dashboard';
import Breeding from './routes/Breeding';
import BuyerProfile from './routes/BuyerProfile';
import Documents from './routes/Documents';
import HorseDetail from './routes/HorseDetail';
import Horses from './routes/Horses';
import MainLayout from './routes/layouts/MainLayout';
import Medical from './routes/Medical';
import NotFound from './routes/NotFound';
import Ownership from './routes/Ownership';
import RanchAssets from './routes/RanchAssets';
import Sales from './routes/Sales';
import Settings from './routes/Settings';
import SharedAccess from './routes/SharedAccess';
import Subscriptions from './routes/Subscriptions';

export default function App() {
  return (
    <HashRouter>
      <ErrorBoundary>
        <ToastViewport />
        <Routes>
          <Route path="/profiles/:id" element={<BuyerProfile />} />
          <Route path="/" element={<MainLayout />}>
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
      </ErrorBoundary>
    </HashRouter>
  );
}
