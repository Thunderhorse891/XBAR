/**
 * Global keyboard shortcut handler.
 * Registered once at the app root via MainLayout.
 */

import { useEffect } from 'react';
import { useUiStore } from '@/store/useUiStore';

export function useGlobalKeyboard() {
  const openCommandPalette = useUiStore((s) => s.openCommandPalette);
  const closeCommandPalette = useUiStore((s) => s.closeCommandPalette);
  const commandPaletteOpen = useUiStore((s) => s.commandPaletteOpen);
  const closeAllDrawers = useUiStore((s) => s.closeAllDrawers);
  const closeDrawer = useUiStore((s) => s.closeDrawer);
  const drawer = useUiStore((s) => s.drawer);
  const openDrawer = useUiStore((s) => s.openDrawer);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // ⌘K or / → command palette (/ only when not in input)
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        if (commandPaletteOpen) closeCommandPalette();
        else openCommandPalette();
        return;
      }
      if (e.key === '/' && !isInput && !commandPaletteOpen) {
        e.preventDefault();
        openCommandPalette();
        return;
      }

      // Esc → close palette, then close drawer(s), then collapse focused card
      if (e.key === 'Escape') {
        if (commandPaletteOpen) {
          closeCommandPalette();
          return;
        }
        if (drawer.isOpen) {
          closeDrawer();
          return;
        }
      }

      // Shift+? → keyboard shortcuts cheatsheet
      if (e.key === '?' && e.shiftKey && !isInput) {
        e.preventDefault();
        openDrawer({ type: 'keyboard-shortcuts' });
        return;
      }

      // Bell icon shortcut: ⌘D → notification centre drawer
      if ((e.metaKey || e.ctrlKey) && e.key === 'd' && !isInput) {
        e.preventDefault();
        openDrawer({ type: 'notification-centre' });
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [commandPaletteOpen, openCommandPalette, closeCommandPalette, closeDrawer, closeAllDrawers, drawer.isOpen, openDrawer]);
}
