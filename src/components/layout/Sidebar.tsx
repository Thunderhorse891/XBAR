import React from 'react';
import { NavLink } from 'react-router-dom';

export default function Sidebar() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `text-sm px-3 py-2 rounded transition-colors block ${isActive ? 'bg-blue-100 text-blue-700 font-semibold' : 'text-gray-700 hover:bg-gray-200'}`;

  return (
    <aside className="bg-gray-50 w-48 flex flex-col border-r border-gray-200 shrink-0">
      <div className="p-4 border-b border-gray-200">
        <h1 className="text-base font-bold text-gray-800">XBAR Records</h1>
      </div>
      <nav className="flex flex-col gap-1 p-3">
        <NavLink to="/" end className={linkClass}>Dashboard</NavLink>
        <NavLink to="/horses" className={linkClass}>Horses</NavLink>
        <NavLink to="/breeding" className={linkClass}>Breeding</NavLink>
        <NavLink to="/medical" className={linkClass}>Medical</NavLink>
        <NavLink to="/sales" className={linkClass}>Sales</NavLink>
      </nav>
    </aside>
  );
}
