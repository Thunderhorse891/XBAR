import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useHorses } from '@/store/useHorses';

export default function Horses() {
  const { horses } = useHorses();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [viewMode, setViewMode] = useState<'Cards' | 'Table'>('Table');
  const [search, setSearch] = useState(searchParams.get('search') || '');

  const filtered = horses.filter(h =>
    [h.name, h.breed, h.owner, h.color].some(v => v?.toLowerCase().includes(search.toLowerCase()))
  );

  const statusStyle = (status?: string) => {
    if (status === 'Active') return { bg: 'rgba(10,132,255,0.1)', color: '#0a84ff' };
    if (status === 'For Sale') return { bg: 'rgba(52,199,89,0.1)', color: '#34c759' };
    if (status === 'Retired') return { bg: 'rgba(142,142,147,0.12)', color: '#8e8e93' };
    return { bg: 'rgba(255,59,48,0.08)', color: '#ff3b30' };
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: '0 0 4px', fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>Horses</h1>
          <p style={{ margin: 0, fontSize: 13, color: '#8e8e93' }}>{filtered.length} of {horses.length} horses</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search horses..."
            style={{ padding: '7px 14px', border: '1px solid rgba(0,0,0,0.1)', borderRadius: 10, fontSize: 13, fontFamily: 'inherit', outline: 'none', width: 200, background: 'rgba(118,118,128,0.12)', color: '#1c1c1e' }} />
          <div style={{ display: 'flex', background: 'rgba(118,118,128,0.12)', borderRadius: 9, padding: 2 }}>
            {(['Cards', 'Table'] as const).map(v => (
              <button key={v} onClick={() => setViewMode(v)}
                style={{ padding: '5px 14px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12, fontFamily: 'inherit', transition: 'all 0.15s',
                  background: viewMode === v ? '#fff' : 'transparent',
                  color: viewMode === v ? '#1c1c1e' : '#8e8e93',
                  fontWeight: viewMode === v ? 600 : 400,
                  boxShadow: viewMode === v ? '0 1px 3px rgba(0,0,0,0.12)' : 'none' }}>
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {viewMode === 'Cards' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
          {filtered.map(h => {
            const ss = statusStyle(h.status);
            return (
              <div key={h.id} onClick={() => navigate(`/horses/${h.id}`)}
                style={{ background: '#fff', borderRadius: 14, padding: '18px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.05)', cursor: 'pointer', transition: 'all 0.2s' }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.1)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)'; e.currentTarget.style.transform = 'none'; }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                  <div style={{ width: 42, height: 42, borderRadius: 12, background: 'linear-gradient(135deg, #e8f4ff, #c0dcff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20 }}>🐴</div>
                  <span style={{ fontSize: 10, fontWeight: 600, padding: '4px 10px', borderRadius: 20, background: ss.bg, color: ss.color }}>{h.status}</span>
                </div>
                <div style={{ fontWeight: 700, fontSize: 14, color: '#1c1c1e', marginBottom: 3 }}>{h.name}</div>
                <div style={{ fontSize: 12, color: '#6d6d72', marginBottom: 10 }}>{h.breed} · {h.color} · {h.age} yrs</div>
                <div style={{ height: 1, background: '#f2f2f7', marginBottom: 10 }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#8e8e93' }}>
                  <span>{h.owner}</span>
                  <span style={{ color: h.registered ? '#34c759' : '#ff9500', fontWeight: 600 }}>{h.registered ? '✓ Registered' : '⚠ Unregistered'}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {viewMode === 'Table' && (
        <div style={{ background: '#fff', borderRadius: 14, overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.05)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9f9fb', borderBottom: '1px solid rgba(0,0,0,0.06)' }}>
                {['Name', 'Breed', 'Color', 'Age', 'Owner', 'Status', 'Registered', 'Last Vet'].map(h => (
                  <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: 11, color: '#8e8e93', fontWeight: 600, letterSpacing: 0.3 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((h, i) => {
                const ss = statusStyle(h.status);
                return (
                  <tr key={h.id} onClick={() => navigate(`/horses/${h.id}`)}
                    style={{ borderBottom: i < filtered.length - 1 ? '1px solid #f2f2f7' : 'none', cursor: 'pointer', transition: 'background 0.1s' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#f9f9fb')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                    <td style={{ padding: '12px 16px', fontWeight: 600, fontSize: 13 }}>{h.name}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#3a3a3c' }}>{h.breed}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#3a3a3c' }}>{h.color}</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#3a3a3c' }}>{h.age} yrs</td>
                    <td style={{ padding: '12px 16px', fontSize: 13, color: '#3a3a3c' }}>{h.owner}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 20, background: ss.bg, color: ss.color }}>{h.status}</span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: h.registered ? '#34c759' : '#ff9500', fontWeight: 600 }}>{h.registered ? '✓ Yes' : '⚠ No'}</td>
                    <td style={{ padding: '12px 16px', fontSize: 12, color: '#8e8e93' }}>{h.lastVetVisit}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
