# XBAR brand assets

This directory contains the artwork used by XBAR's application shell, marketing pages, and exported reports. Treat the supplied artwork as source material: preserve the originals, keep their proportions, and do not silently redraw the horse, X mark, or wordmark.

## Current consumers

| Asset                                                                                               | Current use                                   |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`, `xbar-favicon.png` | Browser, PWA, navigation, and dashboard icons |
| `og-card.jpg`                                                                                       | Social preview card                           |
| `xbar-horse-outline-safe.png`, `xbar-x-watermark-main.png`, `xbar-wordmark.png`                     | Sign-in artwork                               |
| `xbar-report-horse.png`, `xbar-report-mark.png`, `xbar-report-watermark.png`                        | Branded PDF reports                           |

Other files are retained as supplied or historical aliases. Do not infer a supported treatment from a filename alone; check this inventory and the actual pixels first.

`favicon.ico` has no consumer at all. Nothing references it, and a browser's implicit request goes to `/favicon.ico` while this file sits at `/brand/favicon.ico`, so it is never fetched either. `index.html` declares `brand/xbar-favicon.png` instead.

## Known aliases

The following groups are byte-identical, despite names that imply different crops or treatments:

- `xbar-brand-hero.png`, `xbar-horse-logo-lockup-main.png`, and `xbar-horse-main-logo-26.png`
- `xbar-horse-contour.png`, `xbar-horse-only.png`, `xbar-horse-only-blue-glow.png`, `xbar-horse-outline-safe.png`, and `xbar-watermark-horse.png`
- `xbar-icon-mark.png` and `xbar-x-mark-transparent.png`
- `xbar-watermark-x.png`, `xbar-x-watermark-main.png`, and `xbar-x-watermark-premium.png`

Keep existing aliases while code still references them. New consumers should use the asset already assigned to that surface instead of choosing an alias by its name. Any future deduplication must update all consumers and preserve a documented canonical file.

## Raster-backed SVG files

`xbar-horse-contour.svg`, `xbar-watermark-x.svg`, and `xbar-wordmark.svg` embed base64 PNG images inside an SVG wrapper. They are not editable vector masters and do not gain true resolution independence from the `.svg` extension. Do not use them as evidence that a scalable official mark exists.

## Homepage pilot encodings

`xbar-report-horse-landing.webp` (1672 × 941) and `xbar-report-mark-landing.webp`
(1254 × 1254) are lossless WebP encodings of Erin's original
`xbar-report-horse.png` and `xbar-report-mark.png`. They keep the same composition,
colours, dimensions, and decoded pixels; the PNG masters remain unchanged.
Only the public homepage pilot uses these encodings, through `<picture>` with
the original PNG fallback. The below-fold X image loads lazily. These files
reduce transfer size without creating a new mark, tracing or re-lettering it.

## Governance

- Preserve Erin's supplied master artwork unchanged. Resize it proportionally and render it at or below its intrinsic dimensions.
- Smaller encodings of the same composition may be produced for performance, but keep the original beside them and document the derivative and its consumer.
- Tracing, simplifying, recolouring, re-lettering, recomposing, or creating a new small-size mark is a new visual derivative and requires Erin's review before release.
- Do not approximate the official wordmark with a font and present it as the master.
- Do not add registered-mark symbols, certification claims, or company-registration claims without supporting evidence and explicit approval.
- Keep decorative artwork out of working data surfaces when it reduces contrast or readability. Brand decoration must not carry instructions or state.

When adding an asset, record its provenance, intended surfaces, canonical filename, intrinsic dimensions, and whether it is an approved master or a derived export.

## Cinematic identity study (updated September 14)

The preview now animates the unchanged `xbar-report-horse.png` master (1672x941) using browser-native opacity and scale keyframes. The supplied Meta-marked `horse.mp4` and its extracted `poster.jpg` have been removed from published assets; Erin's original desktop files remain unchanged. The sample card also uses the original PNG.

The entrance plays once and offers pause/replay. Reduced-motion and data-saving visitors begin with static artwork. No video or external media service is loaded. Figures and horse names remain illustrative. This is a separate preview, not the production shell or a new vector logo master.

## Signature refinement preview (October 3, 2026)

The owner requested a recognizable horse-only signature, a finite 1.5-second
silver/icy-blue outline highlight, graphite/charcoal navigation, and spacious
white working surfaces. This preview is held for visual approval; it is not a
recovered official vector master.

- `xbar-signature-paths.json` is the single geometry source for the derivative.
  Its source SHA pins the unchanged `xbar-report-horse.png`. Detailed `paths`
  trace the intro; nine filled `compactPaths` close corresponding contour
  ribbons for clean navigation and icons. The full viewBox
  overlays that supplied master; the compact viewBox crops the same coordinates.
- `xbar-signature-horse*.svg` and the corresponding PNGs are generated from
  that geometry, with compact exports using the filled profile and minimal eye/mane gaps.
- `xbar-signature-icon.svg`, icon PNGs, and the maskable PNG use an opaque
  graphite ground so the silver horse remains visible in light and dark chrome.
- React `XbarMark` and public header/footer/hero markup use those same real paths.
  `src/lib/signatureMotion.ts` gives the entire highlight exactly 1,500 ms,
  once on entry or pointer hover. The static base is always present; reduced
  motion, data saving, a hidden tab, or the homepage pause control stop it.
- Email and sample-packet headers use static PNG fallbacks. Existing report
  masthead artwork remains; the small footer mark uses the signature print PNG.
- Sealed buyer packets are deliberately unchanged: their format and verifier
  reject extra image/SVG elements. A future signature insertion needs its own
  reviewed format revision; branding must never weaken that verification.

All pre-existing supplied assets are preserved byte-for-byte. The tracing
proof and small-size/maskable checks document this derivative for approval;
no generic horse, replacement wordmark, or perpetual flashing is introduced.

## Customer ranch branding in seller packets (October 2026)

Customers can save a ranch logo, public phone and website in Settings → Ranch
profile. Existing ranch/business names, seller name and operations email appear
alongside them. These fields travel in the workspace profile payload; no new
storage bucket or schema migration is required. Uploads accept PNG/JPEG, at most
256 KiB and 2048 × 2048 pixels, and are decoded then re-encoded as PNG. Only
embedded validated raster bytes are used; no remote logo URL is fetched.

Local HTML packets use credential format v6: customer header/logo/contact are
sealed, including the logo's content digest, and the verifier pins the logo's
attributes, position, count and dimensions. The packet stylesheet is unchanged.
Previously saved v5 packets and their exact CSP script hash remain supported.
Cloud PDFs use server credential v3 with the same normalized ranch identity and
contact. The public verification page shows the sealed snapshot, including logo
and contact, rather than the customer's subsequently edited profile. Historical
v1/v2 server payloads are verified by their original canonical bytes.

Customer branding is distinct from XBAR's verification seal and link, which
remain visible. This feature does not change plans, limits, pricing or offer
white-label removal of the verification identity. Supplied XBAR assets remain
unchanged.
