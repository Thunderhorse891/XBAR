import { useEffect } from 'react';

const delegatedTargets = [
  '.table-row--interactive',
  '.horse-card--interactive',
  '.stack-item--interactive',
  '.ops-record-card',
  '.ownership-row',
  '.priority-card',
].join(',');

const disabledExplanation = 'Unavailable for your current role or until this record has the required information.';

function prepareInteractiveElements(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>(delegatedTargets).forEach((element) => {
    if (element.tabIndex < 0) element.tabIndex = 0;
    if (!element.getAttribute('role')) element.setAttribute('role', 'button');
    if (!element.getAttribute('title')) element.setAttribute('title', 'Press Enter to open. Right-click or press Shift+F10 for actions when available.');
  });

  root.querySelectorAll<HTMLElement>('button:disabled, [role="button"][aria-disabled="true"], input:disabled, select:disabled, textarea:disabled').forEach((element) => {
    if (!element.getAttribute('title')) element.setAttribute('title', disabledExplanation);
    if (!element.getAttribute('aria-description')) element.setAttribute('aria-description', element.getAttribute('title') ?? disabledExplanation);
  });
}

export function InteractionBootstrap() {
  useEffect(() => {
    prepareInteractiveElements();

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) {
            if (node.matches(delegatedTargets) || node.matches(':disabled, [aria-disabled="true"]')) prepareInteractiveElements(node.parentNode ?? document);
            else prepareInteractiveElements(node);
          }
        });
        if (mutation.type === 'attributes' && mutation.target instanceof HTMLElement) prepareInteractiveElements(mutation.target.parentNode ?? document);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'aria-disabled'] });

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(delegatedTargets) : null;
      if (!target || target.matches('button, a, input, select, textarea') || target.getAttribute('aria-disabled') === 'true') return;

      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        target.click();
        return;
      }

      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        const bounds = target.getBoundingClientRect();
        target.dispatchEvent(new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: bounds.left + Math.min(bounds.width, 32),
          clientY: bounds.top + Math.min(bounds.height, 32),
        }));
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      observer.disconnect();
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return null;
}
