import React from 'react';
import { Outlet } from 'react-router-dom';
import Nav from '../../components/layout/Nav';
import Sidebar from '../../components/layout/Sidebar';

export default function MainLayout() {
  return (
    <div className="flex h-screen w-full bg-gray-100 overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Nav />
        <main className="flex-1 overflow-auto p-6 bg-gray-50">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
