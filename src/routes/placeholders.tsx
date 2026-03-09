import React from 'react';

function PlaceholderPage({ title, emoji }: { title: string; emoji: string }) {
  return (
    <div>
      <h1 style={{ margin: '0 0 20px', fontSize: 22, fontWeight: 700, letterSpacing: -0.5 }}>{title}</h1>
      <div style={{ background: '#fff', borderRadius: 14, padding: 64, textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.05)' }}>
        <div style={{ width: 56, height: 56, borderRadius: 16, background: 'linear-gradient(135deg, #e8f4ff, #c0dcff)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, margin: '0 auto 16px' }}>{emoji}</div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1c1c1e', marginBottom: 6 }}>{title} Records</div>
        <div style={{ fontSize: 13, color: '#8e8e93', marginBottom: 20 }}>Add records to get started.</div>
        <button style={{ padding: '10px 22px', background: '#0a84ff', color: '#fff', border: 'none', borderRadius: 10, fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 600, boxShadow: '0 2px 8px rgba(10,132,255,0.3)' }}>
          + Add First Record
        </button>
      </div>
    </div>
  );
}

export function Breeding() { return <PlaceholderPage title="Breeding" emoji="🧬" />; }
export function Medical() { return <PlaceholderPage title="Medical" emoji="🩺" />; }
export function Sales() { return <PlaceholderPage title="Sales" emoji="📋" />; }
