import React, { ReactNode } from 'react';
import Nav from './Nav';
import Sidebar from './Sidebar';

type LayoutProps = {
  children: ReactNode;
};

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="flex h-screen w-full bg-gray-100 min-h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 bg-white overflow-hidden">
        <Nav />
        <main className="p-4 flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
