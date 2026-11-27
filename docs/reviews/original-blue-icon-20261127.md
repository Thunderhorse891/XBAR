# Approved original blue icon, V2

The app's Apple touch icon, browser favicon and manifest icons now use Erin's
approved original graphite X with brighter blue highlights. This is an icon-only
change based on current main `6d548c4ccc7e19864566847774316b6b0a575ecd`.

The sole approved source is `XBAR-Original-Blue-V2-1024.png`, SHA-256
`43b7b697184aaa4906f39df66698f2154b8a60b6606320557d1d011018334e98`.
The 1024 master is retained byte for byte. Normal 16/32/64/180/192/512 PNGs are
full-canvas Lanczos exports. Maskable 512 contains the entire source at 400×400,
centered on its opaque background; the mark is not cropped, redrawn or recolored.
`source.json` records dimensions, derivation and every exported file's SHA.
The superseded 629bd2ec source and rejected horse-cutout SVGs are not shipped.

`config/brand-assets.json` is the canonical selected icon mapping. The public
renderer consumes it; parity tests pin the SPA head and static manifest to it.
Both root public pages and app/login/signup heads use revisioned Apple touch and
16/32 browser icon URLs. Installed identity remains `/app`, scope `/`, standalone;
the explicit id `/app` preserves the former default from start_url. No worker
registration, cache, private data, auth, billing, native binary or in-app horse
artwork is changed.

Verification: 184/184 configured test commands passed (3,099 reported tests),
app TypeScript passed, ESLint passed with four existing warnings, full Prettier
passed, and the Vite/marketing build passed. Two built-browser cases verify
actual HTTP 200 icon retrieval and public/app heads at 390px and 1440px;
SHA/dimension/RGB tests also pass.
The original branding test still rejects the old silhouette; only its selected
manifest-icon expectation changes to the newly approved original X. The icon
map uses a bundled JSON import so the existing native routing harness and Vite
configuration do not depend on a runtime file URL.

These are local/CI regression checks, not physical iPhone installation evidence.
Existing web clips' icon refresh is controlled by iOS and is not guaranteed.
Do not advise removal/re-addition without safely backed-up/cloud-synced local
records and files. Native/TestFlight icons require a separately installed native
build. A branch push or protected preview does not update the public customer app.

## Release gate and rollback

The stable customer alias remains on production c81b03b, deployment
`dpl_5jofKNrk927A73vrgm5R9xxWwhwa`. Current main is ahead by two commits for #413's
fictional public Copilot demo, including a marketing build change. This PR adds
only icons to main; a production build from this branch would also contain that
separate, unpromoted difference. No authorization for that promotion is inferred.

GitHub Main ruleset 16702794 is active: PR required, `ci` and `Vercel` required,
no bypass actors, no force pushes. Repository policy additionally requires final
head CI/CodeQL/Analyze, review-thread readback, Vercel/Supabase verification and
existing production approvals. The required review count of zero in GitHub does
not waive the repository review contract. #413 records manual publishing;
current auto-assignment must still be verified before any main merge is used as
evidence that the customer alias cannot move. Existing Supabase advisor gates
and unrelated production scope remain outstanding, not icon defects to bypass.

Rollback is an isolated revert of the icon commit and its references. Keep the
stable manifest identity. No database operation or customer storage reset is
needed. Do not force a worker reset or promise immediate iOS icon-cache eviction.
