# XBAR Interaction System

## Contract

XBAR interaction behavior is explicit. Static panels stay visually quiet. Records and actions advertise click, keyboard, focus, and menu behavior.

Surface modes use one state machine:

- `collapsed`: header only.
- `expanded`: normal working view.
- `detailed`: full-width information view.
- `focus`: isolated full-screen work view.

Use `useUiStore().sendSurfaceEvent(id, event)` to change modes. Surface state is remembered in browser-local UI preferences; it does not alter ranch records or cloud data.

## Shared Primitives

Use the exports in `src/components/InteractionSystem.tsx`:

- `InteractiveCard` and `InteractiveRow`: record navigation with Enter/Space and optional Shift+F10 actions.
- `ActionMenuButton`: visible overflow menu trigger.
- `LockedAction`: disabled control with an explanation.
- `RememberedAccordion`: disclosure state that survives navigation.
- `StatefulSurface`: collapsed, expanded, detailed, and focus modes.
- `Timeline`: chronological records.
- `TaskItem`: Linear-style work item.
- `DocumentBlock`: Notion-inspired document row.
- `AsyncState`: consistent loading, empty, and error feedback.

`InteractionShell` owns global `Ctrl/Cmd+K` search, the command palette, focus-mode escape behavior, and the right drawer.

## Keyboard

- `Enter` or `Space`: open focused record.
- `Shift+F10` or Context Menu key: open actions.
- `Ctrl/Cmd+K` or `/`: open global search.
- `Escape`: close command palette, right drawer, or focus mode.

Nested buttons and links must stop propagation when placed inside an interactive record.

## Accessibility

- Every interactive record needs an accessible name.
- Disabled actions require a reason in `title` or visible supporting text.
- Focus indicators must remain visible against every surface.
- Do not encode status with color alone.
- Respect `prefers-reduced-motion`.

## Adoption Order

1. Use primitives for new UI.
2. Replace route-specific record interactions while preserving handlers.
3. Move repeated action menus into record-level menu definitions.
4. Verify keyboard, touch, and reduced-motion behavior before publishing.
