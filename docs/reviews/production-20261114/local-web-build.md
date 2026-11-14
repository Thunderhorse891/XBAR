# Production review: batch 3, local web build isolation

Baseline: draft #396 at `17d4f3c53c20143a1794ff2a301225ed73089980`.
This independent patch changes only the local smoke build launcher and its tests.
It does not change the production build command, native release launcher,
public artwork, plan names, prices, entitlements or live settings.

Reproduced: inherit VITE_NATIVE_APP=true and XBAR_SKIP_MARKETING=1 from a mobile
build, then execute the actual build-local launcher with only its child spawn
intercepted. The child still receives native=true and skip-marketing=1 despite
this being the web smoke builder. The regression failed on native=true before
correction. Pin web/native/marketing target values explicitly, as the auth smoke
launchers already do.

Also replace deletion of cloud configuration keys with explicit empty values.
Vite's real loadEnv resolves production env files when keys are absent; the test
uses a temporary synthetic .env.production to prove empty child overrides keep
local cloud accounts disabled. No credentials or real service is contacted.
The seven-test native-routing/launcher suite passes. Full checks and exact-head
remote CI must be reported separately. This is not an actual-device test.

`coverage-build-and-migrations.csv` overlays prior inventory hashes for the two
reread launcher/test files and adds four manually read prepared migrations.
Together with #398 and #399: 32 reviewed, 757 pending maintained code/configuration
files, 140 excluded files, out of the same 929 tracked baseline files. New review
artifacts are outside that original denominator. Hash mismatch requires rereview.

The migration read identifies a candidate consistency defect: the effective
commercial-resource trigger counts lifetime sale packets, while the server and
client allowance renews over 30 days. Isolate and reproduce against disposable
PostgreSQL before changing it. No migration was applied to Supabase. Hosted
old-upload capability draining, coordinated migration authorization, actual
phone upload/recovery and report sharing remain release blockers.
