# Production review: batch 2, exact capacity counts

Baseline: unchanged draft #396 at `17d4f3c53c20143a1794ff2a301225ed73089980`.
Independent of #398's operator-reporting correction and #397's naming proposal.
No public tier names, prices, limits, migrations or production settings change.

## Reproduced behavior and correction

Starting state: an exact-count Supabase query resolves successfully, but its
count is missing (`null`/`undefined`) or malformed. A request for one additional
horse, document, packet or seat reaches the corresponding capacity helper.
Expected: usage cannot be established, so return a retryable service refusal.
Actual before correction: `Number(count || 0)` treats missing usage as an empty
workspace; malformed values can also make the comparison pass.

Four new controlled-response regressions fail on the baseline (documents,
horses, packets, seats). The correction accepts only nonnegative safe integer
counts and validates both halves of the seat total, including sum overflow.
Verified zero, exact fit and over-limit behavior stay distinct. Unknown usage
returns 503/retryable with no invented upgrade demand.

An older horse-capacity test explicitly claimed null meant an empty workspace.
That expectation was incorrect, rather than a valid guarantee being relaxed.
A regression using the real pinned Supabase client and synthetic HTTP responses
proves that `Content-Range: */0` produces zero while an omitted count header
produces null. No network, live account, live data or offensive procedure is
used. The replacement asserts both the real empty-workspace allowance and the
unknown-count refusal. Existing boundary and invitation-exclusion cases remain.

Focused capacity/storage/status/packet suites pass 111 tests. Full required
checks and exact-head remote CI must be reported separately; fixtures alone do
not establish hosted behavior or close migration/device launch gates.

## Additional review coverage

Apply `coverage-addendum.csv` as an overlay on #398's baseline `coverage.csv`.
It contains 14 newly read first-party files, not a second full inventory.
Together the ledgers record 28 reviewed, 761 pending maintained code/configuration
files, and 140 excluded files out of the original 929 tracked-file baseline.
Hashes identify reviewed bytes. The changed capacity helper/tests are reviewed
at their corrected contents; the other listed files are unchanged.

The batch includes server permissions, managed-billing flags, price verification,
entitlements, capacity tests, native routing tests and seven maintained build,
preview and verification scripts. No paid catalog or entitlement setting is
changed. Auth bootstrap/storage/password modules were only partially read in an
output-truncated read and remain pending; their presence in a command is not
counted as completed coverage. Database migrations and actual device behavior
remain pending. Browser-native bundle tests are not installed-device evidence.

Follow-up candidate from script review: build-local inherits native/marketing
skip flags unlike the auth smoke wrappers. Establish the actual child build
environment before deciding whether it needs a separate correction. Do not mix
that launcher change into the capacity patch.
