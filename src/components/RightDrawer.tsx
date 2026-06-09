/**
 * RightDrawer — singleton right-side drawer system.
 * Handles 2-level nesting with focus lock, backdrop, and keyboard management.
 */

import { useEffect, useId, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useXbarStore } from '@/store/useXbarStore';
import { useUiStore } from '@/store/useUiStore';
import type { DrawerContent } from '@/store/useUiStore';

/* ── Focus lock ─────────────────────────────────────────────────────── */
function useFocusLock(ref: React.RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const el = ref.current;
    const focusable = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const first = el.querySelector<HTMLElement>(focusable);
    first?.focus();

    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const all = Array.from(el.querySelectorAll<HTMLElement>(focusable)).filter(
        (n) => !n.hasAttribute('disabled'),
      );
      if (all.length === 0) { e.preventDefault(); return; }
      const firstEl = all[0];
      const lastEl = all[all.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    el.addEventListener('keydown', trap);
    return () => el.removeEventListener('keydown', trap);
  }, [active, ref]);
}

/* ── Drawer content renderers ────────────────────────────────────────── */

function HorseDetailDrawerContent({ horseId }: { horseId: string }) {
  const horse = useXbarStore((s) => s.horses.find((h) => h.id === horseId));
  if (!horse) return <div className="drawer-body"><p className="text-muted">Horse not found.</p></div>;
  return (
    <div className="drawer-body">
      <div className="drawer-entity-header">
        {horse.profileImage ? (
          <img src={horse.profileImage} alt={horse.name} className="drawer-entity-avatar" />
        ) : (
          <div className="drawer-entity-avatar drawer-entity-avatar--placeholder">
            {horse.name.slice(0, 2).toUpperCase()}
          </div>
        )}
        <div>
          <div className="drawer-entity-name">{horse.name}</div>
          <div className="drawer-entity-meta">{horse.breed || 'Unknown breed'} · {horse.sex} · {horse.age > 0 ? `${horse.age}yo` : 'Age unknown'}</div>
        </div>
      </div>
      <div className="drawer-section-list">
        <div className="drawer-kv-grid">
          <div className="drawer-kv"><span>Owner</span><strong>{horse.owner || '—'}</strong></div>
          <div className="drawer-kv"><span>Status</span><strong>{horse.status}</strong></div>
          <div className="drawer-kv"><span>Location</span><strong>{horse.location.barn || horse.location.pasture || '—'}</strong></div>
          <div className="drawer-kv"><span>Segment</span><strong>{horse.segment}</strong></div>
          <div className="drawer-kv"><span>AQHA</span><strong>{horse.aqhaNumber || '—'}</strong></div>
          <div className="drawer-kv"><span>Reg #</span><strong>{horse.registrationNumber || '—'}</strong></div>
        </div>
        {horse.summary && <p className="drawer-summary">{horse.summary}</p>}
      </div>
      <div className="drawer-footer">
        <Link to={`/horses/${horse.id}`} className="button button--primary button--full">
          Open full profile
        </Link>
      </div>
    </div>
  );
}

function HorseHealthDrawerContent({ horseId }: { horseId: string }) {
  const horse = useXbarStore((s) => s.horses.find((h) => h.id === horseId));
  if (!horse) return <div className="drawer-body"><p className="text-muted">Horse not found.</p></div>;
  const health = horse.medicalTimeline ?? [];
  return (
    <div className="drawer-body">
      <div className="drawer-section-title">Health Timeline</div>
      {health.length === 0 ? (
        <p className="text-muted drawer-empty">No health records. Add a vet visit or vaccine in the Health module.</p>
      ) : (
        <div className="drawer-timeline">
          {health.slice().reverse().map((ev) => (
            <div key={ev.id} className="drawer-timeline-item">
              <div className="drawer-timeline-date">{ev.date}</div>
              <div>
                <div className="drawer-timeline-title">{ev.title}</div>
                {ev.summary && <div className="drawer-timeline-body">{ev.summary}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="drawer-footer">
        <Link to="/medical" className="button button--ghost">Go to Health module</Link>
      </div>
    </div>
  );
}

function HorseBreedingDrawerContent({ horseId }: { horseId: string }) {
  const horse = useXbarStore((s) => s.horses.find((h) => h.id === horseId));
  if (!horse) return <div className="drawer-body"><p className="text-muted">Horse not found.</p></div>;
  const timeline = horse.breedingTimeline ?? [];
  return (
    <div className="drawer-body">
      <div className="drawer-section-title">Breeding Records</div>
      {timeline.length === 0 ? (
        <p className="text-muted drawer-empty">No breeding records logged yet.</p>
      ) : (
        <div className="drawer-timeline">
          {timeline.slice().reverse().map((ev) => (
            <div key={ev.id} className="drawer-timeline-item">
              <div className="drawer-timeline-date">{ev.date}</div>
              <div>
                <div className="drawer-timeline-title">{ev.title}</div>
                {ev.summary && <div className="drawer-timeline-body">{ev.summary}</div>}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="drawer-footer">
        <Link to="/breeding" className="button button--ghost">Go to Breeding module</Link>
      </div>
    </div>
  );
}

function HorseDocumentsDrawerContent({ horseId }: { horseId: string }) {
  const horse = useXbarStore((s) => s.horses.find((h) => h.id === horseId));
  const documents = useXbarStore((s) => s.documents.filter((d) => d.horseId === horseId));
  if (!horse) return <div className="drawer-body"><p className="text-muted">Horse not found.</p></div>;
  return (
    <div className="drawer-body">
      <div className="drawer-section-title">Documents ({documents.length})</div>
      {documents.length === 0 ? (
        <p className="text-muted drawer-empty">No documents assigned to this horse.</p>
      ) : (
        <div className="stack-list">
          {documents.map((doc) => (
            <div key={doc.id} className="drawer-doc-item">
              <div>
                <div className="drawer-doc-name">{doc.title}</div>
                <div className="drawer-doc-meta">{doc.type} · {doc.uploadedAt}</div>
              </div>
              <span className={`pill pill--${doc.state === 'Ready' ? 'emerald' : doc.state === 'Needs Review' ? 'amber' : 'slate'}`}>
                {doc.state}
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="drawer-footer">
        <Link to="/documents" className="button button--ghost">Document vault</Link>
      </div>
    </div>
  );
}

function HorseFinancialDrawerContent({ horseId }: { horseId: string }) {
  const receipts = useXbarStore((s) => s.expenseReceipts.filter((r) => r.horseId === horseId));
  const total = receipts.reduce((sum, r) => sum + Number(r.amount || 0), 0);
  return (
    <div className="drawer-body">
      <div className="drawer-section-title">Expenses — ${total.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
      {receipts.length === 0 ? (
        <p className="text-muted drawer-empty">No expenses logged for this horse.</p>
      ) : (
        <div className="stack-list">
          {receipts.slice().reverse().slice(0, 20).map((r) => (
            <div key={r.id} className="drawer-expense-item">
              <div>
                <div className="drawer-doc-name">{r.title}</div>
                <div className="drawer-doc-meta">{r.category} · {r.receiptDate}</div>
              </div>
              <span className="drawer-expense-amount">${Number(r.amount).toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
            </div>
          ))}
        </div>
      )}
      <div className="drawer-footer">
        <Link to="/expenses" className="button button--ghost">Go to Expenses</Link>
      </div>
    </div>
  );
}

function NotificationCentreContent() {
  const toasts = useUiStore((s) => s.toasts);
  return (
    <div className="drawer-body">
      <div className="drawer-section-title">Notification Centre</div>
      {toasts.length === 0 ? (
        <p className="text-muted drawer-empty">No active notifications.</p>
      ) : (
        <div className="stack-list">
          {toasts.map((t) => (
            <div key={t.id} className={`callout callout--${t.tone === 'error' ? 'warning' : 'info'}`}>
              {t.title && <strong>{t.title}: </strong>}{t.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function KeyboardShortcutsContent() {
  const shortcuts = [
    { key: '/ or ⌘K', action: 'Open command palette' },
    { key: 'Esc', action: 'Close drawer / collapse / cancel' },
    { key: '→', action: 'Expand focused card' },
    { key: '←', action: 'Collapse focused card' },
    { key: '⌘D', action: 'Open notification centre' },
    { key: '⌘Enter', action: 'Toggle Focus Mode on card' },
    { key: 'Shift+?', action: 'Show this cheatsheet' },
    { key: '⌘S', action: 'Save changes in drawer' },
  ];
  return (
    <div className="drawer-body">
      <div className="drawer-section-title">Keyboard Shortcuts</div>
      <div className="drawer-shortcuts-grid">
        {shortcuts.map(({ key, action }) => (
          <div key={key} className="drawer-shortcut-row">
            <kbd className="drawer-kbd">{key}</kbd>
            <span className="drawer-shortcut-action">{action}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Content router ──────────────────────────────────────────────────── */
function DrawerBody({ content }: { content: DrawerContent }) {
  switch (content.type) {
    case 'horse-detail': return <HorseDetailDrawerContent horseId={content.horseId} />;
    case 'horse-health': return <HorseHealthDrawerContent horseId={content.horseId} />;
    case 'horse-breeding': return <HorseBreedingDrawerContent horseId={content.horseId} />;
    case 'horse-documents': return <HorseDocumentsDrawerContent horseId={content.horseId} />;
    case 'horse-financial': return <HorseFinancialDrawerContent horseId={content.horseId} />;
    case 'notification-centre': return <NotificationCentreContent />;
    case 'keyboard-shortcuts': return <KeyboardShortcutsContent />;
    default: return null;
  }
}

function drawerTitle(content: DrawerContent, horses: { id: string; name: string }[]): string {
  switch (content.type) {
    case 'horse-detail': return horses.find((h) => h.id === content.horseId)?.name ?? 'Horse';
    case 'horse-health': return 'Health Records';
    case 'horse-breeding': return 'Breeding Records';
    case 'horse-documents': return 'Documents';
    case 'horse-financial': return 'Expenses';
    case 'notification-centre': return 'Notifications';
    case 'keyboard-shortcuts': return 'Keyboard Shortcuts';
    default: return 'Detail';
  }
}

/* ── Main RightDrawer component ──────────────────────────────────────── */
export function RightDrawer() {
  const drawer = useUiStore((s) => s.drawer);
  const closeDrawer = useUiStore((s) => s.closeDrawer);
  const closeAllDrawers = useUiStore((s) => s.closeAllDrawers);
  const horses = useXbarStore((s) => s.horses.map((h) => ({ id: h.id, name: h.name })));
  const drawerRef = useRef<HTMLDivElement>(null);
  const isNested = drawer.stack.length > 0;
  const closeBtnId = useId();

  useFocusLock(drawerRef, drawer.isOpen);

  // Escape handled globally in useGlobalKeyboard, but handle ⌘S here
  useEffect(() => {
    if (!drawer.isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        // drawer-level save: forms inside handle their own submit
        const form = drawerRef.current?.querySelector<HTMLFormElement>('form');
        form?.requestSubmit();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [drawer.isOpen]);

  if (!drawer.isOpen || !drawer.content) return null;

  const title = drawerTitle(drawer.content, horses);
  const parentTitle = isNested && drawer.stack[0]
    ? drawerTitle(drawer.stack[0], horses)
    : null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="drawer-backdrop"
        aria-hidden="true"
        onClick={closeAllDrawers}
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        {/* Header */}
        <div className="drawer-header">
          <div className="drawer-header-left">
            {isNested && (
              <button
                className="drawer-back-btn"
                type="button"
                onClick={closeDrawer}
                aria-label="Back"
              >
                ← Back
              </button>
            )}
            {parentTitle && (
              <span className="drawer-breadcrumb">{parentTitle} /</span>
            )}
            <h2 className="drawer-title">{title}</h2>
          </div>
          <button
            id={closeBtnId}
            className="drawer-close-btn"
            type="button"
            onClick={closeAllDrawers}
            aria-label="Close drawer"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        {drawer.content && <DrawerBody content={drawer.content} />}
      </div>
    </>
  );
}
