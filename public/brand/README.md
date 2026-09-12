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

## Governance

- Preserve Erin's supplied master artwork unchanged. Resize it proportionally and render it at or below its intrinsic dimensions.
- Smaller encodings of the same composition may be produced for performance, but keep the original beside them and document the derivative and its consumer.
- Tracing, simplifying, recolouring, re-lettering, recomposing, or creating a new small-size mark is a new visual derivative and requires Erin's review before release.
- Do not approximate the official wordmark with a font and present it as the master.
- Do not add registered-mark symbols, certification claims, or company-registration claims without supporting evidence and explicit approval.
- Keep decorative artwork out of working data surfaces when it reduces contrast or readability. Brand decoration must not carry instructions or state.

When adding an asset, record its provenance, intended surfaces, canonical filename, intrinsic dimensions, and whether it is an approved master or a derived export.
