# Visual polish: existing hero and horse-roster actions

## Baseline and scope

Base/main: c81b03be9b9faed9aa4a0e8f1e45867aefd0ddc0. Existing production
homepage and public fictional-data tour were inspected read-only in the cloud
browser. No account, cloud record, payment or configuration action was taken.
The current original horse/wordmark artwork, product voice and hero composition
are preserved. No new imagery or derivative logo is introduced.

Before screenshots come from completed run 43622987643 at checkout draft
bc67a55356ed0a150390c875b6729ad3e28ffa66, workspace-design-review artifact 14124732560. The baseline styling files were compared against main with zero diff;
the draft's billing changes are not incorporated. Captures use disposable
Cedar Ridge/Copper Canyon fixture records, not customer data. Named originals
were also retained under output/xbar-visual-polish outside application source.

This is a separate visual-only draft. #405, #406 and #407 branches are untouched.
No authentication, payments, pricing terms, receipt templates, routing, data,
provider settings, environment files or migrations are changed. Existing main
pricing remains owned by the separate checkout rollout; screenshots of a
styling branch do not certify payment wiring or launch readiness.

## Bounded refinements

- Original hero: slightly more relaxed headline tracking, responsive column
  spacing, a restrained artwork frame and matched primary/secondary controls.
  The secondary action now has an explicit outline; phone controls share the
  full available width. Existing margin spacing supports browsers without
  flex-gap. Original motion and reduced-motion behavior remain intact.
- Roster header and horse-card actions: clear graphite primary and quieter
  secondary surfaces, consistent rounded targets, no forced blue glow, and
  visible inherited focus rings. Two secondary actions share a row; Horse
  record spans the card width. Disabled and click behavior are unchanged.
- Card information: more legible labels, safe wrapping and, on phones, owner
  across the full row with location/registry below. Saved photographs, scrim,
  status labels, readiness calculations and all field values are unchanged.

Legacy metal/premium CSS forced glossy styles with important declarations.
Only the two named roster action contexts are excluded from those old selectors
so their component CSS can apply. No new important declaration or global theme
rewrite is used; checkout, sign-in and other application controls retain their
existing selectors and styling.

## Validation and review gates

Typecheck, test-project compilation, ESLint (four existing warnings), formatting,
diff checks, app/marketing build and the full configured test chain pass with
Node's supported tsx loader substitution. Canonical npm test was attempted and
reaches the environment's existing tsx IPC listen EPERM.

The new built-bundle Playwright cases cover 390px and 1440px: unchanged headline
and original asset, matched phone hero widths, 48px hero targets, 44px card
controls, full-width primary record action, primary text contrast at least
4.5:1, keyboard focus, honest Pending facts and no page overflow. Empty and
populated roster plus hero PNGs are saved as workspace-polish-* in the existing
workspace-design-review artifact. These cases require exact-head remote CI;
local browser startup is already blocked by environment network-interface
permissions and no workaround is used. Actual iPhone/Android and assistive
technology acceptance remain unverified.

Before/after visual review remains a release gate. A successful build is not
approval for a broader redesign or production promotion. Keep this PR draft,
inspect retained captures and review the final exact head before any separate
release decision.

## Draft-preview observation

The READY preview of first head c8d0282 was inspected read-only on desktop.
The original artwork/headline were preserved and both hero controls measured
50.75px high. Pause motion kept the full hero visible. A missing decorative
arrow glyph was observed in the secondary action; the follow-up uses a small
font-independent CSS arrow in that existing aria-hidden span. No logo, link
text or destination changes. New final-head captures/checks remain required;
first-head screenshots do not certify a later head.

The earlier command-system stylesheet also forces the same glossy button
properties. Its four rest/hover selectors now exclude the same two roster
contexts; disabled feedback and other routes remain unchanged. This closes the
remaining cascade conflict without adding an important override. Earlier-head
captures/checks must not be transferred to this final selector correction.

Run 43729761304 at fbe106d confirmed the corrected flat roster controls,
44px targets, primary contrast, full-width record link and keyboard focus in
both new card cases before stopping on an incorrect fixture expectation. The
fixture explicitly saves Legal owner as Cedar Ridge; the new assertion still
expected the separately named Cedar Ridge Ranch. The test-only follow-up uses
the explicit saved owner, retaining the registry and overflow assertions.
Application styling is unchanged by that follow-up. Earlier same-CSS captures
are valid visual evidence but do not certify the latest test-head CI result.

Visual capture review also found two inherited phone layout constraints: the
facts container still used display:flex despite new grid columns, and wrapped
header labels retained a fixed control height. The scoped rules now explicitly
use a grid for phone facts and automatic control height with a 44px minimum.
The browser cases measure matching fact rows and header content overflow;
card-only captures make the resulting action hierarchy easier to review.
