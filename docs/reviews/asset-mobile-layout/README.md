# Asset editor mobile containment

Base: delivered main `5df91edee2d31d208822451c674c4ab91b8fd4dd`.

The retained hosted screenshot from CI run `37336437374`, artifact `11357406681`,
shows 744px-wide page content at a 390px viewport after the existing Equipment
creation workflow opens `/assets?asset=...`. The affected view is the canonical
asset editor, not the Equipment overview or its confirmation popup.

The register table retains a deliberate minimum width for readable columns.
Its enclosing grid panels had automatic minimum widths, so the table expanded
the whole grid and maintenance form instead of scrolling inside its wrapper.
The correction gives only this route's grid and panels a zero minimum width.
The existing table wrapper keeps horizontal scrolling and gains a named,
keyboard-focusable region with the existing focus color. No columns are hidden,
and no record, save, delete, permission or navigation behavior changes.

The added browser cases repeat the legitimate synthetic create-to-editor flow
at 390px and 1440px (the actual two-column desktop layout). They check page/control bounds, keyboard table scrolling,
reload persistence and screenshots. The mobile case temporarily restores the
previous panel minimum and requires overflow to recur with the same fixture,
then removes that style and requires containment again. Browser execution is
pending hosted CI; local cloud-browser access was denied and was not bypassed.

## Remaining consistency and keyboard audit

- Sidebar/search destinations use shared canonical Health, Breeding and Equipment
  paths. Health uses the shared care model and explicitly links its records view.
  Equipment explicitly opens the canonical asset editor.
- The shared create drawer uses the existing accessible dialog primitive; its
  hosted keyboard/focus restoration regressions remain in the suite.
- Ownership History already has a keyboard-accessible Review sources button for
  each clickable row. Medical and asset rows have keyboard handlers, including
  propagation isolation for the medical completion button. No missing control
  is claimed solely because a row also handles mouse clicks.
- Breeding overview's separate inference and mouse-only row remain owned by the
  held breeding PR302. This patch does not claim those findings are delivered.
