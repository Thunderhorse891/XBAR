/**
 * CommandPalette — global Spotlight-style search overlay.
 * Triggered by ⌘K or / from anywhere in the app.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';

type ResultItem = {
  id: string;
  label: string;
  sublabel?: string;
  category: string;
  action: () => void;
  icon?: string;
};

function scoreMatch(text: string, query: string): number {
  if (!query) return 1;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 50;
  // fuzzy: all query chars appear in order
  let pos = 0;
  for (const ch of q) {
    const idx = t.indexOf(ch, pos);
    if (idx === -1) return 0;
    pos = idx + 1;
  }
  return 20;
}

export function CommandPalette() {
  const open = useUiStore((s) => s.commandPaletteOpen);
  const close = useUiStore((s) => s.closeCommandPalette);
  const openDrawer = useUiStore((s) => s.openDrawer);
  const horses = useXbarStore((s) => s.horses);
  const documents = useXbarStore((s) => s.documents);

  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const navigate = useNavigate();

  // Reset query when opened
  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIdx(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo<ResultItem[]>(() => {
    const q = query.trim();

    const staticActions: ResultItem[] = [
      { id: 'nav-dashboard', label: 'Go to Dashboard', category: 'Navigation', icon: '⊞', action: () => { navigate('/'); close(); } },
      { id: 'nav-horses', label: 'Go to Horses', category: 'Navigation', icon: '◉', action: () => { navigate('/horses'); close(); } },
      { id: 'nav-health', label: 'Go to Health & Care', category: 'Navigation', icon: '♥', action: () => { navigate('/medical'); close(); } },
      { id: 'nav-breeding', label: 'Go to Breeding', category: 'Navigation', icon: '◎', action: () => { navigate('/breeding'); close(); } },
      { id: 'nav-documents', label: 'Go to Documents', category: 'Navigation', icon: '▣', action: () => { navigate('/documents'); close(); } },
      { id: 'nav-expenses', label: 'Go to Expenses', category: 'Navigation', icon: '$', action: () => { navigate('/expenses'); close(); } },
      { id: 'nav-sales', label: 'Go to Sales', category: 'Navigation', icon: '◇', action: () => { navigate('/sales'); close(); } },
      { id: 'nav-ownership', label: 'Go to Ownership', category: 'Navigation', icon: '◈', action: () => { navigate('/ownership'); close(); } },
      { id: 'nav-marketplace', label: 'Go to Marketplace', category: 'Navigation', icon: '◆', action: () => { navigate('/marketplace'); close(); } },
      { id: 'nav-reminders', label: 'Go to Reminders', category: 'Navigation', icon: '◔', action: () => { navigate('/reminders'); close(); } },
      { id: 'nav-assets', label: 'Go to Ranch Assets', category: 'Navigation', icon: '⬡', action: () => { navigate('/assets'); close(); } },
      { id: 'nav-settings', label: 'Go to Settings', category: 'Navigation', icon: '⚙', action: () => { navigate('/settings'); close(); } },
      { id: 'action-upload', label: 'Upload documents', category: 'Action', icon: '↑', action: () => { navigate('/documents?upload=1'); close(); } },
      { id: 'action-new-horse', label: 'Add new horse', category: 'Action', icon: '+', action: () => { navigate('/horses?new=1'); close(); } },
      { id: 'action-log-expense', label: 'Log an expense', category: 'Action', icon: '$', action: () => { navigate('/expenses'); close(); } },
      { id: 'action-add-care', label: 'Add care event', category: 'Action', icon: '♥', action: () => { navigate('/medical'); close(); } },
      { id: 'drawer-notifications', label: 'Notification centre', category: 'System', icon: '◉', action: () => { openDrawer({ type: 'notification-centre' }); close(); } },
      { id: 'drawer-shortcuts', label: 'Keyboard shortcuts', category: 'System', icon: '⌨', action: () => { openDrawer({ type: 'keyboard-shortcuts' }); close(); } },
    ];

    const horseItems: ResultItem[] = horses.map((h) => ({
      id: `horse-${h.id}`,
      label: h.name,
      sublabel: `${h.breed || h.segment} · ${h.sex} · ${h.status}`,
      category: 'Horse',
      icon: '◉',
      action: () => { openDrawer({ type: 'horse-detail', horseId: h.id }); close(); },
    }));

    const docItems: ResultItem[] = documents.slice(0, 50).map((d) => ({
      id: `doc-${d.id}`,
      label: d.title,
      sublabel: `${d.type} · ${d.state}`,
      category: 'Document',
      icon: '▤',
      action: () => { openDrawer({ type: 'document-preview', documentId: d.id }); close(); },
    }));

    const all = [...staticActions, ...horseItems, ...docItems];

    if (!q) {
      return staticActions.slice(0, 8);
    }

    return all
      .map((item) => ({
        item,
        score: Math.max(
          scoreMatch(item.label, q),
          scoreMatch(item.sublabel ?? '', q),
          scoreMatch(item.category, q),
        ),
      }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map(({ item }) => item);
  }, [query, horses, documents, navigate, close, openDrawer]);

  // Clamp active index when results change
  useEffect(() => {
    setActiveIdx((prev) => Math.min(prev, Math.max(results.length - 1, 0)));
  }, [results.length]);

  // Scroll active item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const active = list.children[activeIdx] as HTMLElement | undefined;
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      results[activeIdx]?.action();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  };

  if (!open) return null;

  const grouped = results.reduce<Record<string, ResultItem[]>>((acc, item) => {
    (acc[item.category] ??= []).push(item);
    return acc;
  }, {});

  let flatIdx = 0;

  return (
    <>
      <div className="cp-backdrop" aria-hidden="true" onClick={close} />
      <div
        className="cp-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="cp-search-row">
          <span className="cp-search-icon" aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            className="cp-input"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder="Search horses, documents, actions…"
            aria-label="Command palette search"
            aria-autocomplete="list"
            aria-controls="cp-results"
            aria-activedescendant={results[activeIdx] ? `cp-item-${results[activeIdx].id}` : undefined}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="cp-esc-hint" onClick={close}>Esc</kbd>
        </div>

        {results.length > 0 ? (
          <ul
            ref={listRef}
            id="cp-results"
            className="cp-results"
            role="listbox"
            aria-label="Command palette results"
          >
            {Object.entries(grouped).map(([category, items]) => (
              <li key={category} className="cp-group" role="presentation">
                <div className="cp-group-label">{category}</div>
                <ul role="group">
                  {items.map((item) => {
                    const idx = flatIdx++;
                    const isActive = idx === activeIdx;
                    return (
                      <li
                        key={item.id}
                        id={`cp-item-${item.id}`}
                        className={`cp-item${isActive ? ' cp-item--active' : ''}`}
                        role="option"
                        aria-selected={isActive}
                        onMouseEnter={() => setActiveIdx(idx)}
                        onClick={item.action}
                      >
                        {item.icon && <span className="cp-item-icon" aria-hidden="true">{item.icon}</span>}
                        <span className="cp-item-label">{item.label}</span>
                        {item.sublabel && <span className="cp-item-sub">{item.sublabel}</span>}
                        <span className="cp-item-category">{item.category}</span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <div className="cp-empty">No results for "{query}"</div>
        )}

        <div className="cp-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>Esc</kbd> close</span>
        </div>
      </div>
    </>
  );
}
