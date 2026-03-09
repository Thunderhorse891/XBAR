import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useHorses } from '@/store/useHorses';

const card = { background: '#fff', borderRadius: 14, padding: '20px 22px', boxShadow: '0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.04)', border: '1px solid rgba(0,0,0,0.05)' };

export default function HorseDetail() {
  const { id } = useParams<{ id: string }>();
  const { horses } = useHorses();
  const navigate = useNavigate();
  const horse = horses.find(h => h.id === id);
  const [tab, setTab] = useState<'overview' | 'medical' | 'breeding'>('overview');

  if (!horse) return (
    <div style={card}>
      <p style={{ color: '#8e8e93' }}>Horse not found.</p>
      <button onClick={() => navigate('/horses')} style={{ color: '#0a84ff', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>← Back to Horses</button>
    </div>
  );

  const statusStyle = horse.status === 'Active' ? { bg: 'rgba(10,132,255,0.1)', color: '#0a84ff' }
    : horse.status === 'For Sale' ? { bg: 'rgba(52,199,89,0.1)', color: '#34c759' }
    : { bg: 'rgba(142,142,147,0.12)', color: '#8e8e93' };

  return (
    <div>
      <button onClick={() => navigate('/horses')} style={{ background: 'none', border: 'none', color: '#0a84ff', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', fontWeight: 500, marginBottom: 20, padding: 0 }}>← Back to Horses</button>

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #e8f4ff, #c0dcff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28 }}>🐴</div>
          <div>
            <h1 style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 700, letterSpacing: -0.5 }}>{horse.name}</h1>
            <p style={{ margin: 0, color: '#8e8e93', fontSize: 13 }}>{horse.breed} · {horse.color} · {horse.age} yrs</p>
          </div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, padding: '6px 14px', borderRadius: 20, background: statusStyle.bg, color: statusStyle.color }}>{horse.status}</span>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, background: 'rgba(118,118,128,0.12)', borderRadius: 10, padding: 3, width: 'fit-content', marginBottom: 16 }}>
        {(['overview', 'medical', 'breeding'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding: '6px 16px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', transition: 'all 0.15s', textTransform: 'capitalize',
              background: tab === t ? '#fff' : 'transparent',
              color: tab === t ? '#1c1c1e' : '#8e8e93',
              fontWeight: tab === t ? 600 : 400,
              boxShadow: tab === t ? '0 1px 3px rgba(0,0,0,0.12)' : 'none' }}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#8e8e93', letterSpacing: 0.5, marginBottom: 14 }}>HORSE DETAILS</div>
            {[['Owner', horse.owner], ['Gender', horse.gender ?? '—'], ['Color', horse.color], ['Age', `${horse.age} years`], ['Breed', horse.breed], ['Last Vet Visit', horse.lastVetVisit], ['Registered', horse.registered ? '✓ Yes' : '⚠ No']].map(([label, val]) => (
              <div key={label as string} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f2f2f7', fontSize: 13 }}>
                <span style={{ color: '#8e8e93' }}>{label}</span>
                <span style={{ fontWeight: 500 }}>{val}</span>
              </div>
            ))}
          </div>
          <div style={card}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#8e8e93', letterSpacing: 0.5, marginBottom: 14 }}>NOTES</div>
            <p style={{ margin: 0, fontSize: 13, color: '#3a3a3c', lineHeight: 1.7 }}>{horse.medicalNotes || 'No notes on file.'}</p>
          </div>
        </div>
      )}

      {tab === 'medical' && (
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#8e8e93', letterSpacing: 0.5, marginBottom: 14 }}>MEDICAL HISTORY</div>
          <p style={{ margin: 0, color: '#8e8e93', fontSize: 13 }}>No medical records on file. Add records to get started.</p>
        </div>
      )}

      {tab === 'breeding' && (
        <div style={card}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#8e8e93', letterSpacing: 0.5, marginBottom: 14 }}>BREEDING RECORDS</div>
          <p style={{ margin: 0, color: '#8e8e93', fontSize: 13 }}>No breeding records on file. Add records to get started.</p>
        </div>
      )}
    </div>
  );
}
