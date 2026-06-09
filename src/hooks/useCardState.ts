/**
 * Card state machine hook.
 * Manages collapsed/expanded/detailed/focus transitions per entity.
 * Persists to localStorage via cardState lib.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  type CardStatus,
  getEntityPrefs,
  setEntityExpandedSections,
  setEntityStatus,
  toggleEntitySection,
} from '@/lib/cardState';

export type { CardStatus };

export function useCardState(entityId: string) {
  const [status, setStatusState] = useState<CardStatus>(() => {
    return getEntityPrefs(entityId).status === 'focus' || getEntityPrefs(entityId).status === 'detailed'
      ? 'collapsed'
      : getEntityPrefs(entityId).status;
  });
  const [expandedSections, setExpandedSectionsState] = useState<string[]>(
    () => getEntityPrefs(entityId).expandedSections ?? [],
  );
  const headerRef = useRef<HTMLElement | null>(null);

  // Persist status changes
  const setStatus = useCallback(
    (next: CardStatus) => {
      setStatusState(next);
      setEntityStatus(entityId, next);
    },
    [entityId],
  );

  const expand = useCallback(() => setStatus('expanded'), [setStatus]);
  const collapse = useCallback(() => setStatus('collapsed'), [setStatus]);
  const openDetailed = useCallback(() => setStatus('detailed'), [setStatus]);
  const openFocus = useCallback(() => setStatus('focus'), [setStatus]);
  const exitFocus = useCallback(() => setStatus('expanded'), [setStatus]);

  const toggleSection = useCallback(
    (sectionId: string) => {
      const next = toggleEntitySection(entityId, sectionId);
      setExpandedSectionsState(next);
    },
    [entityId],
  );

  const setSections = useCallback(
    (sections: string[]) => {
      setExpandedSectionsState(sections);
      setEntityExpandedSections(entityId, sections);
    },
    [entityId],
  );

  const isSectionOpen = useCallback(
    (sectionId: string) => expandedSections.includes(sectionId),
    [expandedSections],
  );

  // Keyboard: → expands, ← collapses, ⌘Enter toggles focus
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;

    const handler = (e: KeyboardEvent) => {
      if (e.target !== el && !el.contains(e.target as Node)) return;
      if (e.key === 'ArrowRight' && status === 'collapsed') {
        e.preventDefault();
        expand();
      } else if (e.key === 'ArrowLeft' && status === 'expanded') {
        e.preventDefault();
        collapse();
      } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        if (status === 'focus') exitFocus();
        else openFocus();
      }
    };

    el.addEventListener('keydown', handler);
    return () => el.removeEventListener('keydown', handler);
  }, [status, expand, collapse, openFocus, exitFocus]);

  return {
    status,
    expandedSections,
    isCollapsed: status === 'collapsed',
    isExpanded: status === 'expanded',
    isDetailed: status === 'detailed',
    isFocus: status === 'focus',
    expand,
    collapse,
    openDetailed,
    openFocus,
    exitFocus,
    toggleSection,
    setSections,
    isSectionOpen,
    headerRef,
  };
}
