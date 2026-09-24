# XBAR brand assets

This directory contains the artwork used by XBAR's application shell, marketing pages, and exported reports.

## The Crossbar (current identity)

Erin's Field Command brand kit (September 2026) specifies the logo: **the Crossbar**, a solid geometric X above a detached horizontal bar, with a custom uppercase XBAR wordmark. Everything in `crossbar/` is that identity. The React component `src/components/BrandMark.tsx` draws the same outlines inline in `currentColor`; `tests/crossbarMark.test.ts` fails if the two ever differ, or if the construction below drifts.

### Construction

- **Grid:** 32 units. The X is a 24 × 24 square, centred with 4 units either side.
- **X:** two equal 45° bands, 4 units thick measured across the band, with square terminals (cut at right angles to the band). Each band's corners touch the square's edges, so the square is the X's outermost extent.
- **Bar:** 4 units tall, 4 units below the X, exactly as wide as the X. Detached: no shield, circle or badge around either.
- **Wordmark:** XBAR in Barlow Condensed Bold, converted to vector outlines. Cap height 24 units, matching the X, on the X's baseline. The font's rounded corners (every curve under 0.6 units at this size) are rebuilt as square corners where their straight edges meet; the bowls of B and R are left as drawn. Tracking is opened by 0.06 × cap height, then each pair is optically spaced (XB −0.35, BA −0.25, AR −0.2 units) after the font's own kerning.
- **Lockup:** the mark, an 8-unit space, then the wordmark. 98.6132 × 32 units.
- **Colour:** a monochrome master. Default limestone `#EEF0E8` on carbon `#0C0F0D`; reverse carbon on limestone. Chartreuse is reserved for interaction and never appears in the logo.

Barlow Condensed is licensed under the SIL Open Font License 1.1, which permits its glyphs to be converted to outlines for a logo. The generator is a one-off script (opentype.js reading `@fontsource/barlow-condensed`, rasterized in Chromium); it is not a project dependency. The outlines in `BrandMark.tsx` are the master.

### Inventory and consumers

| File in `crossbar/`                                     | Size                    | Used by                                                                  |
| ------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------ |
| `xbar-crossbar-mark.svg` / `-reverse.svg`               | 32 × 32 units           | Standalone mark, limestone / carbon                                      |
| `xbar-crossbar-lockup.svg` / `-reverse.svg`             | 98.6 × 32 units         | Marketing header and footer (limestone on the dark site)                 |
| `xbar-crossbar-favicon.svg`, `favicon-32.png`           | 32 × 32                 | Browser tab, app and marketing                                           |
| `apple-touch-icon.png`                                  | 180 × 180               | iOS home screen, app and marketing                                       |
| `icon-192.png`, `icon-512.png`, `icon-512-maskable.png` | 192, 512, 512           | PWA manifest (`site.webmanifest`), JSON-LD logo                          |
| `xbar-crossbar-icon.svg`, `-icon-maskable.svg`          | 512 × 512               | Sources for the icon PNGs (maskable keeps the mark in the central 60%)   |
| `og-card.png`                                           | 1200 × 630              | Social share card, with "Every horse. Every record. One command."        |
| `report-logo.png`                                       | 1672 × 941, transparent | PDF masthead: carbon lockup in the 16:9 canvas the report layout expects |
| `report-mark.png`                                       | 512 × 512, transparent  | PDF footer mark                                                          |
| `report-watermark.png`                                  | 1672 × 941, transparent | PDF watermark                                                            |

In the app, the sidebar, sign-in, workspace setup and password reset render `XbarWordmark` inline; the sidebar and dashboard watermarks render `XbarMark`. None of them load an image.

## Legacy artwork

The files below are the previous identity. Nothing in the product renders them any more; they stay deployed for rollback and because `tests/prod-smoke/smoke.spec.ts` still checks they resolve. The one exception is `xbar-report-horse.png`, which the sign-in screen's illustration and the cinematic preview still use until the Field Command skin replaces them.

| Asset                                                                                               | Former use                                    |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `xbar-favicon.png` | Browser, PWA, navigation, and dashboard icons |
| `og-card.jpg`                                                                                       | Social preview card                           |
| `xbar-horse-outline-safe.png`, `xbar-x-watermark-main.png`, `xbar-wordmark.png`                     | Sign-in artwork                               |
| `xbar-report-horse.png`, `xbar-report-mark.png`, `xbar-report-watermark.png`                        | Branded PDF reports                           |

Other files are retained as supplied or historical aliases. Do not infer a supported treatment from a filename alone; check this inventory and the actual pixels first.

`favicon.ico` has no consumer at all. Nothing references it, and a browser's implicit request goes to `/favicon.ico` while this file sits at `/brand/favicon.ico`, so it is never fetched either.

## Known aliases

The following groups are byte-identical, despite names that imply different crops or treatments:

- `xbar-brand-hero.png`, `xbar-horse-logo-lockup-main.png`, and `xbar-horse-main-logo-26.png`
- `xbar-horse-contour.png`, `xbar-horse-only.png`, `xbar-horse-only-blue-glow.png`, `xbar-horse-outline-safe.png`, and `xbar-watermark-horse.png`
- `xbar-icon-mark.png` and `xbar-x-mark-transparent.png`
- `xbar-watermark-x.png`, `xbar-x-watermark-main.png`, and `xbar-x-watermark-premium.png`

Keep existing aliases while code still references them. New consumers should use the asset already assigned to that surface instead of choosing an alias by its name. Any future deduplication must update all consumers and preserve a documented canonical file.

## Raster-backed SVG files

`xbar-horse-contour.svg`, `xbar-watermark-x.svg`, and `xbar-wordmark.svg` embed base64 PNG images inside an SVG wrapper. They are not editable vector masters and do not gain true resolution independence from the `.svg` extension. Do not use them as evidence that a scalable official mark exists.

## Governance

- The Crossbar is the master. Do not redraw, trace, simplify, recolour, re-letter or recompose it, and never set the wordmark as live text: use `XbarMark` / `XbarWordmark` or the files in `crossbar/`.
- New sizes are rendered from the same outlines, not redrawn. Record the file, its size and its consumer in the inventory above.
- A new visual derivative — a small-size variant, a different lockup, a coloured version — is Erin's decision. Ask.
- Keep legacy files unchanged while anything (including the smoke test) references them. Any future deletion must update those references first.
- Do not add registered-mark symbols, certification claims, or company-registration claims without supporting evidence and explicit approval.
- Keep decorative artwork out of working data surfaces when it reduces contrast or readability. Brand decoration must not carry instructions or state.

When adding an asset, record its provenance, intended surfaces, canonical filename, intrinsic dimensions, and whether it is a master or a derived export.

## Cinematic identity study (updated September 14)

The preview now animates the unchanged `xbar-report-horse.png` master (1672x941) using browser-native opacity and scale keyframes. The supplied Meta-marked `horse.mp4` and its extracted `poster.jpg` have been removed from published assets; Erin's original desktop files remain unchanged. The sample card also uses the original PNG.

The entrance plays once and offers pause/replay. Reduced-motion and data-saving visitors begin with static artwork. No video or external media service is loaded. Figures and horse names remain illustrative. This is a separate preview, not the production shell or a new vector logo master.
