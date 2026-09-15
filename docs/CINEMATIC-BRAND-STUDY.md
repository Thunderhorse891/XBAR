# Cinematic brand implementation study

Erin's updated direction is graphics-rich and cinematic. This supersedes the earlier recommendation to keep all brand presentation restrained. Working records still require legible, stable text and controls.

## Reviewable implementation

- Preview: `/brand/cinematic-preview/index.html`, separate from normal application navigation.
- Original supplied horse PNG, unchanged, animated with a browser-native reveal. The Meta-marked video and its poster are no longer published.
- Charcoal/silver scene, blue edge detail, interactive identity/care/ownership graphic, sale-preparation and records views, and an illustrative executive-report graphic.
- Play-once entrance with pause/resume and replay, reduced-motion support, save-data preference, no video download and hidden/offscreen motion suspension.
- External local CSS/JavaScript works with the existing Content Security Policy. No external media service or paid API.
- Desktop/mobile visual checks and Playwright coverage exercise playback, pause, keyboard tabs, reduced motion and horizontal overflow.

## Shared work with Claude

Claude's verified suggestions include consistent semantic color tokens, accessible primary-button contrast, faithful proportions and smaller sign-in assets. Codex asked Claude to implement that token/contrast slice and review OCR failure/review UX with real damaged/mixed-file fixtures. Codex owns this cinematic study, artwork inventory and report branding/export reliability. Claude's reply or implementation is not presumed complete merely because the request was posted.

## Report reliability delivered alongside the study

Brand PNG paths now respect the deployment base (including `/XBAR/`). Successful artwork loads are saved in a dedicated optional cache and can be reused if later requests fail, independently of service-worker control. Cache denial does not break an online export. HTML route fallbacks are rejected rather than cached as artwork. Without either valid network artwork or cached originals, the user receives a clear reconnect message and their records are unchanged. This is not offline-first-use support.

## Acceptance still needed

The study remains separate from the production UI. The original 1672x941 horse artwork is animated in the browser without redrawing the logo. Reduced-motion and data-saving visitors see the static artwork until they request playback. Legal status and unrelated access/security launch gates are unchanged.

The actual sign-in screen also consumes the shared `motion-brand-in` entrance on its decorative brand panel. Form controls remain stationary. A rendered test verifies that reduced-motion settings disable the entrance.

## September 15 � hero detail enhancement

Kept the layout, copy, supplied horse PNG and navigation intact. Added a
non-interactive decorative layer with thin silver-blue contours and three small
light flecks (two on mobile), plus a soft light field and report/CTA rim lighting.
Flecks drift once, follow pause and offscreen/hidden state, and remain static
under reduced motion. No new media downloads or libraries. Desktop/mobile
screenshots reviewed; decorative layers do not capture clicks or enter the
accessibility tree. This remains an illustrative brand preview, not a replacement
for the working ranch dashboard.
