import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import MainLayout from './routes/layouts/MainLayout';
import Dashboard from './pages/Dashboard';
import Horses from './routes/Horses';
import HorseDetail from './routes/HorseDetail';
import { Breeding } from './routes/Breeding';
import { Medical } from './routes/Medical';
import { Sales } from './routes/Sales';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="horses" element={<Horses />} />
          <Route path="horses/:id" element={<HorseDetail />} />
          <Route path="breeding" element={<Breeding />} />
          <Route path="medical" element={<Medical />} />
          <Route path="sales" element={<Sales />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
