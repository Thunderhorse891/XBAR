# XBAR signature trace: review derivative

Status: local draft for owner visual approval. These files are new derivatives, not replacements for the supplied artwork or an official recovered vector master. No supplied master was modified.

## Canonical geometry

`xbar-signature-paths.json` is the single source of path data. It contains 21 real SVG contour paths traced in the original `xbar-report-horse.png` coordinate system, plus nine filled compact pieces made by closing corresponding contours. The renderer consumes this JSON; no SVG contains an embedded raster.

- Report overlay viewBox: `0 0 1672 941`
- Compact viewBox: `330 100 1170 760`
- Compact rendering changes only the viewBox, with uniform scaling. It does not stretch, redraw, or change the proportions of the report horse.
- `paths[].id` is a stable detailed-contour identifier; `paths[].d` is SVG path data; `paths[].detail` identifies decorative detail.
- `compactPaths[]` supplies the filled small-size derivative. Each entry has `id`, `d`, and `fillRule: "evenodd"`. The corresponding contour ribbons are closed, and the head preserves the source profile with eye and nostril cutouts. Navigation, favicon, email, and print should use this filled set. Detailed introduction highlighting should use `paths[]`.
- Both arrays are owner-review derivatives in the same source coordinate system. Compact fill is an authorized simplification, not a different horse source.
- Paths are visible contour traces. Open endpoints and multiple subpaths reflect the source artwork, rather than invented connecting strokes.
- The long neck curves were refined against edge peaks in the source raster. Dark texture, faint trailing mane edges, and a partially occluded rear mane prevent claiming an exact recovery of an original vector master. Review the source-coordinate overlay before release.

The supplied outline-safe horse and report watermark were inspected as references. They have different compositions/proportions, so neither supplies geometry for this derivative. The detailed report illustration remains the canonical reference and unchanged intro artwork.

## Exports

| File                                                   | Surface                   | Treatment                                                         |
| ------------------------------------------------------ | ------------------------- | ----------------------------------------------------------------- |
| `xbar-signature-horse.svg`                             | Main UI signature         | Transparent, silver contour                                       |
| `xbar-signature-horse-silhouette.svg`                  | Main navigation signature | Transparent, silver filled compact profile                        |
| `xbar-signature-horse-small.svg`                       | Small UI signature        | Filled compact profile, same source coordinates                   |
| `xbar-signature-horse-dark.svg`                        | Light surfaces            | Transparent charcoal-blue filled profile                          |
| `xbar-signature-report-overlay.svg`                    | Report-image overlay      | Original 1672 × 941 coordinates                                   |
| `xbar-signature-icon.svg`                              | Browser favicon           | Opaque graphite square, silver filled profile                     |
| `xbar-signature-horse-16.png`, `-32.png`, `-64.png`    | Favicon fallback          | Opaque graphite square, filled compact profile                    |
| `xbar-signature-horse-180.png`, `-192.png`, `-512.png` | Apple/PWA icons           | Opaque graphite square, filled compact profile                    |
| `xbar-signature-horse-maskable-512.png`                | Maskable PWA icon         | Opaque charcoal-blue square; artwork occupies 64% of canvas width |
| `xbar-signature-email-192.png`                         | Email fallback            | Silver on opaque charcoal-blue                                    |
| `xbar-signature-print-512.png`                         | Print/PDF fallback        | Charcoal-blue on opaque white                                     |

Colors are the selected signature palette: graphite `#171B20`, charcoal blue `#202D3C`, platinum `#D6DDE5`, with icy blue `#94D8F2` reserved for the live highlight. Static exports contain no animation. The UI should consume JSON paths for a one-shot 1.5-second highlight and honor reduced motion; animation is an integration responsibility.

The 16-pixel fallback remains recognizable as a horse while necessarily losing interior detail. The 32-pixel filled fallback preserves the mane and face more clearly than the original thin outline draft. The maskable icon's farthest visible artwork pixel is within radius 183.68 pixels of center, inside the required 204.8-pixel safe-circle radius.

## Source integrity

SHA-256 values verified before and after generation:

- `xbar-report-horse.png`: `8a8cc3c6215d2b2f45f260ff3d26848313391fab605799321f11eb9f8503eb54`
- `xbar-horse-outline-safe.png`: `66c6710e8ba1428923a60cae5f15101cfa4a4b0e489990c8f4f04fc9a7cb17ac`
- `xbar-report-watermark.png`: `d3d9404d7d9c6c8a8187bb29b590ae76ae2b4926f73212aea09462c776264201`

The owner-supplied signature reference was visually inspected. Its SHA-256 is `104998c45b8e225999b59904405e4ba5458375e7dd62f22f5c745002de77f381`. It is a visual brief, not the traced geometry source.

## Reproduction

Run `scripts/brand/signature-build.py` with Python and CairoSVG available. CairoSVG can be installed into a temporary environment; it is not an application dependency. The script verifies the report master hash before rendering, then derives every export from the one JSON. Run `scripts/brand/signature-verify.py` to check source integrity, path parity, PNG dimensions/opacity, and the maskable safe circle.
