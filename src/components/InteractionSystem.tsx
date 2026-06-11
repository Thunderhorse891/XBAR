import {
  Children,
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ContextMenu, type ContextMenuItem } from '@/components/ContextMenu';
import { interactionHint, type SurfaceMode } from '@/lib/interactionState';
import { useUiStore } from '@/store/useUiStore';
import { useXbarStore } from '@/store/useXbarStore';

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement && Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function activateOnKey(event: KeyboardEvent<HTMLElement>, onActivate?: () => void, onActions?: (x: number, y: number) => void) {
  if ((event.key === 'Enter' || event.key === ' ') && onActivate) {
    event.preventDefault();
    onActivate();
    return;
  }
  if ((event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) && onActions) {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    onActions(bounds.left + Math.min(bounds.width, 32), bounds.top + Math.min(bounds.height, 32));
  }
}

export function InteractiveCard({
  label,
  children,
  className = '',
  onActivate,
  onActions,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  onActivate?: () => void;
  onActions?: (x: number, y: number) => void;
}) {
  const interactive = Boolean(onActivate || onActions);
  return (
    <article
      className={`interactive-card${interactive ? ' interactive-card--active' : ''} ${className}`.trim()}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? label : undefined}
      title={interactive ? interactionHint(Boolean(onActions)) : undefined}
      onClick={onActivate}
      onKeyDown={interactive ? (event) => activateOnKey(event, onActivate, onActions) : undefined}
      onContextMenu={onActions ? (event) => {
        event.preventDefault();
        onActions(event.clientX, event.clientY);
      } : undefined}
    >
      {children}
    </article>
  );
}

export function InteractiveRow({
  label,
  children,
  className = '',
  onActivate,
  onActions,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  onActivate: () => void;
  onActions?: (x: number, y: number) => void;
}) {
  return (
    <div
      className={`interactive-row ${className}`.trim()}
      role="button"
      tabIndex={0}
      aria-label={label}
      title={interactionHint(Boolean(onActions))}
      onClick={onActivate}
      onKeyDown={(event) => activateOnKey(event, onActivate, onActions)}
      onContextMenu={onActions ? (event) => {
        event.preventDefault();
        onActions(event.clientX, event.clientY);
      } : undefined}
    >
      {children}
    </div>
  );
}

export function ActionMenuButton({
  label = 'Open actions',
  onOpen,
  children = '...',
  className = '',
}: {
  label?: string;
  onOpen: (x: number, y: number) => void;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <button
      className={`action-menu-button ${className}`.trim()}
      type="button"
      aria-label={label}
      title={`${label}. Shift+F10 also opens record actions.`}
      onClick={(event) => {
        event.stopPropagation();
        const bounds = event.currentTarget.getBoundingClientRect();
        onOpen(bounds.right, bounds.bottom + 8);
      }}
    >
      {children}
    </button>
  );
}

export function LockedAction({
  label,
  reason,
  locked,
  onClick,
  className = 'button button--ghost',
}: {
  label: string;
  reason: string;
  locked: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <span className="locked-action">
      <button className={className} type="button" disabled={locked} title={locked ? reason : label} onClick={onClick}>
        {label}
      </button>
      {locked ? <span className="locked-action__reason">{reason}</span> : null}
    </span>
  );
}

export function RememberedAccordion({
  id,
  title,
  summary,
  children,
  defaultMode = 'collapsed',
}: {
  id: string;
  title: string;
  summary?: ReactNode;
  children: ReactNode;
  defaultMode?: Extract<SurfaceMode, 'collapsed' | 'expanded'>;
}) {
  const mode = useUiStore((state) => state.surfaceModes[id] ?? defaultMode);
  const send = useUiStore((state) => state.sendSurfaceEvent);
  const expanded = mode !== 'collapsed';
  return (
    <section className={`remembered-accordion${expanded ? ' remembered-accordion--expanded' : ''}`}>
      <button
        className="remembered-accordion__trigger"
        type="button"
        aria-expanded={expanded}
        aria-controls={`${id}-content`}
        onClick={() => send(id, 'toggle')}
      >
        <span><strong>{title}</strong>{summary ? <small>{summary}</small> : null}</span>
        <span aria-hidden="true">{expanded ? '-' : '+'}</span>
      </button>
      {expanded ? <div id={`${id}-content`} className="remembered-accordion__content">{children}</div> : null}
    </section>
  );
}

export function StatefulSurface({
  id,
  title,
  eyebrow,
  children,
  className = '',
}: {
  id: string;
  title: string;
  eyebrow?: string;
  children: ReactNode;
  className?: string;
}) {
  const mode = useUiStore((state) => state.surfaceModes[id] ?? 'expanded');
  const focusedId = useUiStore((state) => state.focusedSurfaceId);
  const send = useUiStore((state) => state.sendSurfaceEvent);
  const hiddenByFocus = Boolean(focusedId && focusedId !== id);
  if (hiddenByFocus) return null;
  return (
    <section className={`stateful-surface stateful-surface--${mode} ${className}`.trim()} data-surface-id={id}>
      <header className="stateful-surface__header">
        <span>{eyebrow ? <small>{eyebrow}</small> : null}<strong>{title}</strong></span>
        <div className="stateful-surface__controls" aria-label={`${title} display controls`}>
          <button type="button" onClick={() => send(id, 'collapse')} aria-pressed={mode === 'collapsed'} title="Collapse">-</button>
          <button type="button" onClick={() => send(id, 'expand')} aria-pressed={mode === 'expanded'} title="Expand">+</button>
          <button type="button" onClick={() => send(id, 'detail')} aria-pressed={mode === 'detailed'} title="Detailed view">Details</button>
          <button type="button" onClick={() => send(id, mode === 'focus' ? 'expand' : 'focus')} aria-pressed={mode === 'focus'} title="Focus mode">Focus</button>
        </div>
      </header>
      {mode !== 'collapsed' ? <div className="stateful-surface__content">{children}</div> : null}
    </section>
  );
}

type CommandItem = {
  id: string;
  label: string;
  detail: string;
  path: string;
  group: string;
};

const routeCommands: CommandItem[] = [
  ['dashboard', 'Home', 'Daily ranch operations', '/', 'Navigate'],
  ['horses', 'Horse registry', 'All horse records', '/horses', 'Navigate'],
  ['documents', 'Document vault', 'Source records and review', '/documents', 'Navigate'],
  ['ownership', 'Ownership', 'Transfers and proof', '/ownership', 'Navigate'],
  ['medical', 'Health', 'Care records and due work', '/medical', 'Navigate'],
  ['breeding', 'Breeding pipeline', 'Pairings and milestones', '/breeding', 'Navigate'],
  ['sales', 'Sales', 'Buyer pipeline and listings', '/sales', 'Navigate'],
  ['reminders', 'Tasks and reminders', 'Daily work queue', '/reminders', 'Navigate'],
  ['assets', 'Property and equipment', 'Ranch assets and supplies', '/assets', 'Navigate'],
].map(([id, label, detail, path, group]) => ({ id, label, detail, path, group }));

export function InteractionShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const horses = useXbarStore((state) => state.horses);
  const documents = useXbarStore((state) => state.documents);
  const salesLeads = useXbarStore((state) => state.salesLeads);
  const paletteOpen = useUiStore((state) => state.commandPaletteOpen);
  const setPaletteOpen = useUiStore((state) => state.setCommandPaletteOpen);
  const drawer = useUiStore((state) => state.rightDrawer);
  const closeDrawer = useUiStore((state) => state.closeRightDrawer);
  const exitFocus = useUiStore((state) => state.exitFocusMode);
  const focusedSurfaceId = useUiStore((state) => state.focusedSurfaceId);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement | null>(null);

  const commands = useMemo<CommandItem[]>(() => [
    ...routeCommands,
    ...horses.map((horse) => ({ id: `horse-${horse.id}`, label: horse.name, detail: `${horse.segment} | ${horse.location.barn}`, path: `/horses/${horse.id}`, group: 'Horses' })),
    ...documents.slice(0, 40).map((document) => ({ id: `document-${document.id}`, label: document.title, detail: `${document.type} | ${document.state}`, path: '/documents', group: 'Documents' })),
    ...salesLeads.map((lead) => ({ id: `lead-${lead.id}`, label: lead.name, detail: `${lead.stage} buyer`, path: `/follow-ups?lead=${lead.id}`, group: 'Buyers' })),
  ], [documents, horses, salesLeads]);

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return commands.slice(0, 12);
    return commands.filter((item) => `${item.label} ${item.detail} ${item.group}`.toLowerCase().includes(normalized)).slice(0, 20);
  }, [commands, query]);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(!paletteOpen);
      } else if (event.key === '/' && !isEditableTarget(event.target)) {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (event.key === 'Escape') {
        if (paletteOpen) setPaletteOpen(false);
        else if (drawer) closeDrawer();
        else if (focusedSurfaceId) exitFocus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeDrawer, drawer, exitFocus, focusedSurfaceId, paletteOpen, setPaletteOpen]);

  useEffect(() => {
    setPaletteOpen(false);
    closeDrawer();
  }, [closeDrawer, location.pathname, setPaletteOpen]);

  useEffect(() => {
    if (!paletteOpen) return;
    setQuery('');
    setActiveIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [paletteOpen]);

  useEffect(() => {
    document.body.classList.toggle('xbar-focus-mode', Boolean(focusedSurfaceId));
    return () => document.body.classList.remove('xbar-focus-mode');
  }, [focusedSurfaceId]);

  useEffect(() => {
    if (drawer) requestAnimationFrame(() => drawerCloseRef.current?.focus());
  }, [drawer]);

  const run = (item: CommandItem) => {
    setPaletteOpen(false);
    navigate(item.path);
  };

  return (
    <>
      {paletteOpen ? <div className="command-palette-backdrop" role="presentation" onMouseDown={() => setPaletteOpen(false)}>
        <section className="command-palette" role="dialog" aria-modal="true" aria-label="Search XBAR" onMouseDown={(event) => event.stopPropagation()}>
          <div className="command-palette__search">
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((current) => Math.min(results.length - 1, current + 1)); }
                if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((current) => Math.max(0, current - 1)); }
                if (event.key === 'Enter' && results[activeIndex]) { event.preventDefault(); run(results[activeIndex]); }
              }}
              placeholder="Search horses, documents, buyers, and modules"
              aria-label="Search XBAR"
            />
            <kbd>Esc</kbd>
          </div>
          <div className="command-palette__results" role="listbox" aria-label="Search results">
            {results.length ? results.map((item, index) => <button key={item.id} className={`command-palette__result${index === activeIndex ? ' command-palette__result--active' : ''}`} type="button" role="option" aria-selected={index === activeIndex} onMouseEnter={() => setActiveIndex(index)} onClick={() => run(item)}><span><strong>{item.label}</strong><small>{item.detail}</small></span><em>{item.group}</em></button>) : <div className="command-palette__empty">No matching records or modules.</div>}
          </div>
          <footer className="command-palette__footer"><span>Up/down to move</span><span>Enter to open</span><span>Ctrl/Cmd+K anywhere</span></footer>
        </section>
      </div> : null}

      {drawer ? <div className="right-drawer-backdrop" role="presentation" onMouseDown={closeDrawer}>
        <aside className="right-drawer" role="dialog" aria-modal="true" aria-labelledby="right-drawer-title" onMouseDown={(event) => event.stopPropagation()}>
          <header className="right-drawer__header"><span>{drawer.eyebrow ? <small>{drawer.eyebrow}</small> : null}<h2 id="right-drawer-title">{drawer.title}</h2></span><button ref={drawerCloseRef} type="button" onClick={closeDrawer} aria-label="Close details">Close</button></header>
          {drawer.description ? <p className="right-drawer__description">{drawer.description}</p> : null}
          {drawer.facts?.length ? <dl className="right-drawer__facts">{drawer.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl> : null}
          {drawer.actions?.length ? <div className="right-drawer__actions">{drawer.actions.map((action) => <Link key={action.path} className="button button--primary" to={action.path}>{action.label}</Link>)}</div> : null}
        </aside>
      </div> : null}
    </>
  );
}

export function RecordActionMenu({
  state,
  items,
  onClose,
}: {
  state: { x: number; y: number } | null;
  items: ContextMenuItem[];
  onClose: () => void;
}) {
  return <ContextMenu open={Boolean(state)} x={state?.x ?? 0} y={state?.y ?? 0} items={items} onClose={onClose} />;
}

export function DisabledExplanation({ children, reason }: { children: ReactElement; reason: string }) {
  if (!isValidElement(children)) return children;
  return cloneElement(Children.only(children), { title: reason, 'aria-description': reason } as never);
}

export function Timeline({
  label,
  items,
}: {
  label: string;
  items: Array<{ id: string; date: string; title: string; description?: string; tone?: 'default' | 'warning' | 'critical' | 'success'; onActivate?: () => void; action?: ReactNode }>;
}) {
  return (
    <ol className="xbar-timeline" aria-label={label}>
      {items.map((item) => {
        const interactive = Boolean(item.onActivate && !item.action);
        return <li key={item.id} className={`xbar-timeline__item xbar-timeline__item--${item.tone ?? 'default'}${interactive ? ' xbar-timeline__item--interactive' : ''}`} tabIndex={interactive ? 0 : undefined} role={interactive ? 'button' : undefined} onClick={interactive ? item.onActivate : undefined} onKeyDown={interactive ? (event) => activateOnKey(event, item.onActivate) : undefined}><span className="xbar-timeline__marker" aria-hidden="true" /><time>{item.date}</time><strong>{item.title}</strong>{item.description ? <p>{item.description}</p> : null}{item.action ? <span className="xbar-timeline__action">{item.action}</span> : null}</li>;
      })}
    </ol>
  );
}

export function TaskItem({
  title,
  detail,
  status,
  priority = 'normal',
  onActivate,
  action,
}: {
  title: string;
  detail?: string;
  status: string;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  onActivate?: () => void;
  action?: ReactNode;
}) {
  const interactive = Boolean(onActivate && !action);
  return (
    <article className={`xbar-task xbar-task--${priority}${interactive ? ' xbar-task--interactive' : ''}`} role={interactive ? 'button' : undefined} tabIndex={interactive ? 0 : undefined} onClick={interactive ? onActivate : undefined} onKeyDown={interactive ? (event) => activateOnKey(event, onActivate) : undefined}>
      <span className="xbar-task__priority" aria-label={`${priority} priority`} />
      <span className="xbar-task__copy"><strong>{title}</strong>{detail ? <small>{detail}</small> : null}</span>
      <span className="xbar-task__status">{status}</span>
      {action ? <span className="xbar-task__action">{action}</span> : null}
    </article>
  );
}

export function DocumentBlock({
  title,
  type,
  state,
  detail,
  onActivate,
  action,
}: {
  title: string;
  type: string;
  state: string;
  detail?: string;
  onActivate?: () => void;
  action?: ReactNode;
}) {
  return (
    <article className={`document-block${onActivate ? ' document-block--interactive' : ''}`} role={onActivate ? 'button' : undefined} tabIndex={onActivate ? 0 : undefined} onClick={onActivate} onKeyDown={onActivate ? (event) => activateOnKey(event, onActivate) : undefined}>
      <span className="document-block__icon" aria-hidden="true">DOC</span>
      <span className="document-block__copy"><strong>{title}</strong><small>{type}{detail ? ` | ${detail}` : ''}</small></span>
      <span className="document-block__state">{state}</span>
      {action ? <span className="document-block__action" onClick={(event) => event.stopPropagation()}>{action}</span> : null}
    </article>
  );
}

export function AsyncState({
  state,
  title,
  message,
  action,
}: {
  state: 'loading' | 'error' | 'empty';
  title: string;
  message?: string;
  action?: ReactNode;
}) {
  return <div className={`async-state async-state--${state}`} role={state === 'error' ? 'alert' : 'status'} aria-live="polite"><span><strong>{title}</strong>{message ? <p>{message}</p> : null}{action}</span></div>;
}
