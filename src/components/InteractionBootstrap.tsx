import { useEffect, useState } from 'react';
import { ContextMenu, type ContextMenuItem } from '@/components/ContextMenu';

const delegatedTargets = [
  '.table-row--interactive',
  '.horse-card--interactive',
  '.stack-item--interactive',
  '.ops-record-card',
  '.ops-timeline-item',
  '.ownership-row',
  '.priority-card',
].join(',');

const disabledExplanation = 'Unavailable for your current role or until this record has the required information.';

function prepareInteractiveElements(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>(delegatedTargets).forEach((element) => {
    if (!element.getAttribute('role')) {
      if (element.tabIndex < 0) element.tabIndex = 0;
      element.setAttribute('role', 'button');
      if (!element.getAttribute('title'))
        element.setAttribute(
          'title',
          'Press Enter to open. Right-click or press Shift+F10 for actions when available.',
        );
    }
  });

  root
    .querySelectorAll<HTMLElement>(
      'button:disabled, [role="button"][aria-disabled="true"], input:disabled, select:disabled, textarea:disabled',
    )
    .forEach((element) => {
      if (!element.getAttribute('title')) element.setAttribute('title', disabledExplanation);
      if (!element.getAttribute('aria-description'))
        element.setAttribute('aria-description', element.getAttribute('title') ?? disabledExplanation);
    });
}

function labelForAction(element: HTMLElement, fallback: string) {
  return element.getAttribute('aria-label') || element.textContent?.trim() || element.getAttribute('title') || fallback;
}

function fallbackActions(target: HTMLElement): ContextMenuItem[] {
  const actions: ContextMenuItem[] = [];
  const seen = new Set<HTMLElement>();
  const add = (element: HTMLElement, fallback: string) => {
    if (seen.has(element)) return;
    seen.add(element);
    const disabled = element.matches(':disabled, [aria-disabled="true"]');
    actions.push({
      id: `fallback-${actions.length}`,
      label: labelForAction(element, fallback),
      disabled,
      disabledReason: disabled ? (element.getAttribute('title') ?? disabledExplanation) : undefined,
      onSelect: () => element.click(),
    });
  };

  target
    .querySelectorAll<HTMLElement>('button, a[href], [role="button"]')
    .forEach((element) => add(element, 'Open action'));
  if (!target.matches('button, a[href]') && typeof target.onclick === 'function') add(target, 'Open record');
  if (!actions.length && target.matches('button, a[href], [role="button"]')) add(target, 'Open record');
  return actions.slice(0, 8);
}

export function InteractionBootstrap() {
  const [fallbackMenu, setFallbackMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  useEffect(() => {
    prepareInteractiveElements();

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) {
            if (node.matches(delegatedTargets) || node.matches(':disabled, [aria-disabled="true"]'))
              prepareInteractiveElements(node.parentNode ?? document);
            else prepareInteractiveElements(node);
          }
        });
        if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement)
          prepareInteractiveElements(mutation.target.parentNode ?? document);
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled', 'aria-disabled'],
    });

    const openFallback = (target: HTMLElement, x: number, y: number) => {
      const items = fallbackActions(target);
      if (items.length) setFallbackMenu({ x, y, items });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(delegatedTargets) : null;
      if (!target || target.getAttribute('aria-disabled') === 'true') return;

      if (
        (event.key === 'Enter' || event.key === ' ') &&
        event.target === target &&
        !target.matches('button, a, input, select, textarea')
      ) {
        event.preventDefault();
        target.click();
        return;
      }

      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        const bounds = target.getBoundingClientRect();
        const contextEvent = new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + Math.min(bounds.width, 32),
          clientY: bounds.top + Math.min(bounds.height, 32),
        });
        target.dispatchEvent(contextEvent);
        if (!contextEvent.defaultPrevented) openFallback(target, contextEvent.clientX, contextEvent.clientY);
      }
    };

    const onContextMenu = (event: MouseEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(delegatedTargets) : null;
      if (!target) return;
      const items = fallbackActions(target);
      if (!items.length) return;
      event.preventDefault();
      setFallbackMenu({ x: event.clientX, y: event.clientY, items });
    };

    let longPressTimer: number | undefined;
    const clearLongPress = () => {
      if (longPressTimer) window.clearTimeout(longPressTimer);
      longPressTimer = undefined;
    };
    const onPointerDown = (event: PointerEvent) => {
      clearLongPress();
      if (
        event.pointerType !== 'touch' ||
        !(event.target instanceof HTMLElement) ||
        event.target.closest('button, a, input, select, textarea')
      )
        return;
      const target = event.target.closest<HTMLElement>(delegatedTargets);
      if (!target) return;
      longPressTimer = window.setTimeout(() => {
        const bounds = target.getBoundingClientRect();
        const contextEvent = new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + Math.min(bounds.width, 32),
          clientY: bounds.top + Math.min(bounds.height, 32),
        });
        target.dispatchEvent(contextEvent);
        if (!contextEvent.defaultPrevented) openFallback(target, contextEvent.clientX, contextEvent.clientY);
      }, 550);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('pointerup', clearLongPress);
    document.addEventListener('pointercancel', clearLongPress);
    document.addEventListener('pointermove', clearLongPress);
    return () => {
      observer.disconnect();
      clearLongPress();
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('pointerup', clearLongPress);
      document.removeEventListener('pointercancel', clearLongPress);
      document.removeEventListener('pointermove', clearLongPress);
    };
  }, []);

  return (
    <ContextMenu
      open={Boolean(fallbackMenu)}
      x={fallbackMenu?.x ?? 0}
      y={fallbackMenu?.y ?? 0}
      items={fallbackMenu?.items ?? []}
      onClose={() => setFallbackMenu(null)}
    />
  );
}
