import React from 'react';
import { NavLink } from 'react-router-dom';

export default function Nav() {
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `text-sm px-3 py-1 rounded transition-colors ${isActive ? 'bg-white text-blue-700 font-semibold' : 'text-white hover:bg-blue-700'}`;

  return (
    <nav className="flex justify-between items-center bg-blue-800 text-white px-6 py-3">
      <h1 className="font-bold text-xl">XBAR</h1>
      <div className="flex gap-2">
        <NavLink to="/" end className={linkClass}>Dashboard</NavLink>
        <NavLink to="/horses" className={linkClass}>Horses</NavLink>
        <NavLink to="/breeding" className={linkClass}>Breeding</NavLink>
        <NavLink to="/medical" className={linkClass}>Medical</NavLink>
        <NavLink to="/sales" className={linkClass}>Sales</NavLink>
      </div>
    </nav>
  );
}
