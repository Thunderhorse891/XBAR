# Cinematic brand implementation study

Erin's updated direction is graphics-rich and cinematic. This supersedes the earlier recommendation to keep all brand presentation restrained. Working records still require legible, stable text and controls.

## Reviewable implementation

- Preview: `/brand/cinematic-preview/index.html`, separate from normal application navigation.
- Original supplied animated horse asset, unchanged; the visible Meta AI mark remains.
- Charcoal/silver scene, blue edge detail, interactive identity/care/ownership graphic, sale-preparation and records views, and an illustrative executive-report graphic.
- Pause/resume, reduced-motion support, save-data preference, muted inline playback and hidden/offscreen video suspension.
- External local CSS/JavaScript works with the existing Content Security Policy. No external media service or paid API.
- Desktop/mobile visual checks and Playwright coverage exercise playback, pause, keyboard tabs, reduced motion and horizontal overflow.

## Shared work with Claude

Claude's verified suggestions include consistent semantic color tokens, accessible primary-button contrast, faithful proportions and smaller sign-in assets. Codex asked Claude to implement that token/contrast slice and review OCR failure/review UX with real damaged/mixed-file fixtures. Codex owns this cinematic study, artwork inventory and report branding/export reliability. Claude's reply or implementation is not presumed complete merely because the request was posted.

## Report reliability delivered alongside the study

Brand PNG paths now respect the deployment base (including `/XBAR/`). Successful artwork loads are saved in a dedicated optional cache and can be reused if later requests fail, independently of service-worker control. Cache denial does not break an online export. HTML route fallbacks are rejected rather than cached as artwork. Without either valid network artwork or cached originals, the user receives a clear reconnect message and their records are unchanged. This is not offline-first-use support.

## Acceptance still needed

The study is a direction to review, not a replacement of the entire production UI. The supplied animation is 832x464, so enlarged full-screen playback is a visual concept rather than a high-resolution production master. No original logo was redrawn; no watermark was removed. Legal status and unrelated access/security launch gates are unchanged.
