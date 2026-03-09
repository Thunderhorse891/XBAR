import React, { useState } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';

const NAV = [
  { label: 'Dashboard', path: '/', icon: '▦' },
  { label: 'Horses', path: '/horses', icon: '⬡' },
  { label: 'Medical', path: '/medical', icon: '✚' },
  { label: 'Breeding', path: '/breeding', icon: '◈' },
  { label: 'Sales', path: '/sales', icon: '◉' },
];

export default function MainLayout() {
  const [search, setSearch] = useState('');
  const navigate = useNavigate();

  const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && search.trim()) {
      navigate(`/horses?search=${encodeURIComponent(search)}`);
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: "-apple-system, 'SF Pro Display', 'Helvetica Neue', sans-serif", background: '#f2f2f7', color: '#1c1c1e', overflow: 'hidden' }}>

      {/* Sidebar */}
      <div style={{ width: 220, background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRight: '1px solid rgba(0,0,0,0.07)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '20px 18px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: 'linear-gradient(145deg, #0a84ff, #0060d0)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(10,132,255,0.35)' }}>
              <span style={{ color: '#fff', fontWeight: 800, fontSize: 14 }}>X</span>
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, color: '#1c1c1e', letterSpacing: -0.3 }}>XBAR</div>
              <div style={{ fontSize: 10, color: '#8e8e93', letterSpacing: 0.5 }}>Horse Management</div>
            </div>
          </div>
        </div>

        <div style={{ height: 1, background: 'rgba(0,0,0,0.06)', margin: '0 14px' }} />

        <nav style={{ flex: 1, padding: '10px' }}>
          <div style={{ fontSize: 10, color: '#8e8e93', fontWeight: 600, letterSpacing: 0.8, padding: '8px 10px 6px' }}>MAIN MENU</div>
          {NAV.map(({ label, path, icon }) => (
            <NavLink key={label} to={path} end={path === '/'}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left' as const,
                padding: '8px 10px', borderRadius: 8, marginBottom: 1, border: 'none', cursor: 'pointer',
                fontSize: 13.5, fontFamily: 'inherit', textDecoration: 'none', transition: 'all 0.15s',
                background: isActive ? '#0a84ff' : 'transparent',
                color: isActive ? '#fff' : '#3a3a3c',
                fontWeight: isActive ? 600 : 400,
              })}>
              <span style={{ fontSize: 12, opacity: 0.7 }}>{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        <div style={{ padding: '12px 16px', borderTop: '1px solid rgba(0,0,0,0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, #5856d6, #af52de)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#fff', fontWeight: 700 }}>EW</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#1c1c1e' }}>Erin Wyrick</div>
              <div style={{ fontSize: 10, color: '#8e8e93' }}>Ranch Owner</div>
            </div>
          </div>
        </div>
      </div>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Topbar */}
        <div style={{ background: 'rgba(255,255,255,0.85)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(0,0,0,0.07)', padding: '12px 28px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ fontSize: 10, color: '#8e8e93', letterSpacing: 0.5 }}>XBAR HORSE MANAGEMENT SYSTEM</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ position: 'relative' }}>
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                onKeyDown={handleSearch}
                placeholder="Search horses..."
                style={{ paddingLeft: 30, paddingRight: 14, paddingTop: 7, paddingBottom: 7, border: '1px solid rgba(0,0,0,0.1)', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: 200, background: 'rgba(118,118,128,0.12)', color: '#1c1c1e' }}
              />
            </div>
            <button
              onClick={() => navigate('/horses')}
              style={{ padding: '7px 16px', background: '#0a84ff', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, boxShadow: '0 2px 8px rgba(10,132,255,0.3)' }}>
              + Add Horse
            </button>
          </div>
        </div>

        <main style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
