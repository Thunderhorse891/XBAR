import React, { useState } from 'react';
import { useHorses } from '@/store/useHorses';
import {
  pushHorsesToWix,
  pullHorsesFromWix,
  ensureWixCollection,
  getWixToken,
  setWixToken,
} from '@/lib/wix';

type SyncStatus = 'idle' | 'busy' | 'success' | 'error';

export default function WixSync() {
  const { horses, setHorses } = useHorses();
  const [status, setStatus] = useState<SyncStatus>('idle');
  const [message, setMessage] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [token, setToken] = useState(getWixToken);

  const statusColor: Record<SyncStatus, string> = {
    idle: '#8e8e93',
    busy: '#ff9500',
    success: '#34c759',
    error: '#ff3b30',
  };

  const statusLabel: Record<SyncStatus, string> = {
    idle: 'Ready',
    busy: 'Syncing...',
    success: 'Synced',
    error: 'Error',
  };

  async function handlePush() {
    setStatus('busy');
    setMessage('');
    try {
      await ensureWixCollection();
      const msg = await pushHorsesToWix(horses);
      setStatus('success');
      setMessage(msg);
    } catch (err) {
      setStatus('error');
      setMessage(String(err));
    }
  }

  async function handlePull() {
    setStatus('busy');
    setMessage('');
    try {
      const pulled = await pullHorsesFromWix();
      if (pulled.length === 0) {
        setStatus('success');
        setMessage('No horses found in Wix — collection may be empty.');
        return;
      }
      setHorses(pulled);
      setStatus('success');
      setMessage(`Pulled ${pulled.length} horses from Wix.`);
    } catch (err) {
      setStatus('error');
      setMessage(String(err));
    }
  }

  function handleSaveToken() {
    setWixToken(token);
    setStatus('idle');
    setMessage('Token saved.');
  }

  const btnBase: React.CSSProperties = {
    padding: '7px 16px',
    borderRadius: 9,
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    fontFamily: 'inherit',
    fontWeight: 600,
    transition: 'opacity 0.15s',
  };

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid rgba(0,0,0,0.06)',
        borderRadius: 14,
        padding: '14px 18px',
        marginBottom: 16,
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Wix logo pill */}
          <div
            style={{
              background: '#000',
              color: '#fff',
              fontSize: 10,
              fontWeight: 800,
              padding: '2px 8px',
              borderRadius: 6,
              letterSpacing: 0.5,
            }}
          >
            Wix
          </div>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#1c1c1e' }}>XBAR LLC — Sync</span>
          {/* Status dot */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div
              style={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                background: statusColor[status],
                transition: 'background 0.3s',
                boxShadow: status === 'busy' ? `0 0 0 2px ${statusColor.busy}44` : 'none',
              }}
            />
            <span style={{ fontSize: 11, color: statusColor[status], fontWeight: 500 }}>
              {statusLabel[status]}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6 }}>
          <button
            style={{ ...btnBase, background: 'rgba(10,132,255,0.1)', color: '#0a84ff' }}
            disabled={status === 'busy'}
            onClick={handlePush}
          >
            Push to Wix ↑
          </button>
          <button
            style={{ ...btnBase, background: 'rgba(52,199,89,0.1)', color: '#34c759' }}
            disabled={status === 'busy'}
            onClick={handlePull}
          >
            Pull from Wix ↓
          </button>
          <button
            style={{ ...btnBase, background: 'rgba(118,118,128,0.1)', color: '#636366' }}
            onClick={() => setShowToken((v) => !v)}
          >
            {showToken ? 'Hide Token' : 'API Token'}
          </button>
        </div>
      </div>

      {/* Status message */}
      {message && (
        <div
          style={{
            fontSize: 12,
            color: statusColor[status],
            background:
              status === 'error'
                ? 'rgba(255,59,48,0.06)'
                : status === 'success'
                ? 'rgba(52,199,89,0.06)'
                : 'rgba(255,149,0,0.06)',
            borderRadius: 8,
            padding: '6px 10px',
            marginBottom: showToken ? 10 : 0,
          }}
        >
          {message}
        </div>
      )}

      {/* Token editor */}
      {showToken && (
        <div style={{ marginTop: message ? 0 : 4, display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste Wix IST token..."
            style={{
              flex: 1,
              padding: '7px 12px',
              borderRadius: 9,
              border: '1px solid rgba(0,0,0,0.12)',
              fontSize: 11,
              fontFamily: 'monospace',
              color: '#1c1c1e',
              background: '#f9f9fb',
              outline: 'none',
            }}
          />
          <button
            style={{ ...btnBase, background: '#1c1c1e', color: '#fff' }}
            onClick={handleSaveToken}
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}
