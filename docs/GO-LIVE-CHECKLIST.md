# Go-live checklist — actions outside this repository

Track the evidence below separately from repository tests. Passing tests alone
does not establish production readiness.

## Launch scope within the current budget

Optional paid integrations may be deliberately deferred. Their absence alone
does not block a launch of the features that work without them. Keep unavailable
actions clearly labeled, offer usable local/manual paths, and never report an
unsent email, unsynced record or incomplete purchase as successful.

- **Fix before releasing enabled features:** data-loss and permission defects,
  unreliable account/session behavior, broken core actions, and unusable layouts.
  Cloud-account email/link completion still needs verification if cloud accounts
  are offered. Shared-account deletion safety remains open below.
- **Verify when enabling an integration:** real automated checkout/webhook flow,
  paid email delivery, and other intentionally deferred API-backed features.
  These checks are release gates for those features, not a requirement to buy
  optional services before releasing a narrower, honestly labeled product.

This scope does not authorize paid-service activation or assume that existing
production integrations have been disabled. Record the actual enabled feature
set before release.

## Verified September 11, 2026

- Diagnosed the intermittent "stored session not published after reload" failure
  to its cause rather than retrying around it. The offline service worker
  installs with `skipWaiting()` and activates with `clients.claim()`, so on any
  load with no previous controller -- a first visit, a cleared cache, a private
  window -- it claims the open document and fires `controllerchange`.
  `src/lib/offlineRuntime.ts` reloaded on that unconditionally. Measured with
  request, storage and navigation traces: the reload landed roughly 200ms into a
  first load and aborted the `GET /auth/v1/user` that auth-js issues inside
  `_getSessionFromURL` in **10 of 12 runs** (`net::ERR_ABORTED`, coincident with
  the brand icons, `navType=reload`, `controller=true`). It was survivable only
  because auth-js clears the fragment _after_ that request returns, so the
  reloaded document could start the callback over -- at the cost of a second
  round trip and a session published about 180ms late.
- The residual risk that is now closed: auth-js clears the URL fragment with
  `window.location.hash = ''` **before** the caller stores the session
  (confirmed in `@supabase/auth-js` 2.100.1 `_getSessionFromURL`). A reload
  arriving in that window leaves the token in neither the URL nor storage, and
  recovery and magic links are single-use -- the customer would have had to
  request another email. `offlineRuntime.ts` now refreshes only when a worker
  replaces an _earlier_ controller, and never in a document that arrived on an
  auth callback. The guard was first written to lift as soon as the URL was
  clean, which still left that window open, because a cleared URL is not
  evidence that the session has been stored; `602f6fe` latched it for the
  document's lifetime instead, and that is the correct reading.
- Removing that reload exposed a second, pre-existing defect it had been
  masking. `RequireWorkspaceSetup` decided "this ranch was never set up" from
  `useWorkspaceHydrated()`, which only reports that zustand has read **local**
  storage; on a device the account has never used that resolves at once with an
  empty profile. Measured navigation trail on a cold load of `/app/settings`:
  `/app/settings` -> `/app/setup` -> `/app`, with the redirect at 502ms and the
  cloud `workspace_profiles` response not arriving until 615ms. A customer
  signing in on a new phone was shown the onboarding wizard for a ranch they
  finished months ago and then dropped on the dashboard, losing the link they
  followed. The guard now waits for the cloud's answer before calling a
  workspace unfinished, and renders immediately once it is set up so an ordinary
  token refresh cannot blank a working screen.
- Both fixes were mutation-checked rather than assumed. Each guard in
  `offlineRuntime.ts` and in `lib/workspaceSetupGate.ts` was neutralised in turn
  and confirmed to break at least one test; the browser cases were re-run
  against the reverted source and fail 5/5 and 6/6 respectively. Two tests were
  discarded during this work for passing with and without their fix -- a
  document counter held on `window` (which the reload it measured resets) and a
  cold-device staging that cleared only `localStorage` while the workspace
  records live in IndexedDB.
- **Release gate, shared documents are unreadable by everyone but their
  uploader. The defect is confirmed; my attempted fix was WITHDRAWN.** The
  private-bucket policy `horse documents read own` (production-schema.sql)
  authorizes an object by path prefix --
  `auth.uid()::text = split_part(name, '/', 1)` -- and client uploads are
  written to `${uploader}/documents/${horse}/${file}`. The document RECORD is
  authorized by workspace. Measured on PostgreSQL 16.13 with both policies
  verbatim and a workspace holding an owner plus one active member:

  | account                             | document records visible | storage objects visible |
  | ----------------------------------- | ------------------------ | ----------------------- |
  | uploader                            | 1                        | 2                       |
  | active member of the same workspace | 1                        | **0**                   |
  | invited, not yet active             | 0                        | 0                       |
  | outsider                            | 0                        | 0                       |

  The app opens files with `createSignedUrl` under the customer's own JWT
  (`cloudWorkspace.ts` `getDocumentAccessUrl`), and a signed URL needs select on
  the object, so a shared ranch can list its documents and open none of them.
  That much stands.

  `20260911150000_shared_document_storage_access.sql` granted select on any
  object named by a document row in a workspace the caller can reach. Review
  found two faults in it and both are correct:

  1. **It never would have worked.** `saveWorkspaceBackupToRelationalCloud`
     writes no `storage_path` column at all -- the path lives only inside
     `payload` -- so for every document uploaded through the UI the column keeps
     its empty default and the policy's predicate never matches. The evidence
     recorded here earlier came from a synthetic row whose `storage_path` was
     set by hand: a fixture was tested, not the path the product actually
     writes.
  2. **It was forgeable.** An owner or Admin can insert a document row in a
     workspace they manage carrying any `storage_path` they like, including the
     name of another tenant's object -- which a former member of that tenant
     would know. The policy would then grant them select on it. A workspace
     association that document writers can author is not an authorization fact.

  The migration and its check were removed rather than patched, and runbook
  step 9 with them. Nothing was ever applied to a real project, so no
  production state depended on it.

  A correct fix needs the object-to-workspace binding to be server-owned and
  unforgeable. The cleanest is to stop keying storage paths by uploader: write
  to `${workspaceId}/...` and have the INSERT policy require that first segment
  be a workspace the uploader may write to, so Storage enforces the association
  itself with no dependence on a table anyone can write. That changes the upload
  path and leaves existing objects under user prefixes to migrate, which is a
  design change and not a bounded fix. Until it is done, shared documents remain
  openable only by whoever uploaded them.

- `horse-media` is a PUBLIC bucket, so horse photos are unaffected by the above.
  That is worth a separate decision rather than relief: anyone holding the URL
  of a media object can read it without being signed in at all.
- A migration can no longer smuggle in `create policy if not exists`, which is
  not PostgreSQL syntax in any version. production-schema.sql survives it only
  because `scripts/prepare-supabase-schema.mjs` rewrites that form, and it
  rewrites the schema alone -- migrations are concatenated verbatim, so such a
  statement fails at `if` and takes the rest of the file with it. The first
  draft of the migration above made exactly that mistake and nothing caught it
  until PostgreSQL did; the prepare step now refuses it by name.
- Two reset-flow defects raised in review were confirmed by measurement before
  being fixed, not taken on description. (a) auth-js broadcasts
  `PASSWORD_RECOVERY` to every tab and this store's subscriber ADOPTS it, so a
  tab with an older password update still in flight ends up holding a NEWER
  grant -- and its own completion cleared that marker unconditionally, revoking
  a link that was never used. With the older update held open, the first tab's
  stored grant really did become the second tab's token and read back empty on
  completion. Both links are one-time, so a customer whose other tab had closed
  had to request another email. (b) A rejected magic-link or OAuth callback
  started from Settings or Billing comes back to that page, and only `Login`
  ever read the `authError` parameter: signed in the customer saw nothing at
  all, and signed out the auth guard's redirect dropped the query before the
  one screen that would have read it.
- **A cross-tab sign-in was sometimes ignored, and the cause was this PR's own
  auth gate. Now fixed.** What looked like a flaky test
  (`held-workspace.spec.ts:449`, zero relational reads after 30s) was chased
  rather than re-run. Reproduced twice in 120 instrumented runs, with the same
  trace both times, captured by listening on auth-js's own broadcast channel in
  the receiving tab:

  ```
  STORE     sub=0001                                    <- this tab stores its own session
  BROADCAST event=PASSWORD_RECOVERY eventSub=0001 storedSub=0001
  BROADCAST event=SIGNED_IN         eventSub=0002 storedSub=0001   <- still 0001
  ```

  The second tab had already written session 0002 to the SHARED localStorage
  before broadcasting. Yet at the instant the broadcast was handled, this tab's
  own read still returned 0001: localStorage is not synchronously coherent
  across renderer processes, so a BroadcastChannel message can outrun the write
  it describes. `useCloudStore`'s listener asked whether the STORED session
  agreed with the event, got "no" for a perfectly good newer event, and dropped
  it -- the tab never switched accounts, never hydrated, and stayed on the
  previous account until reloaded.

  The repair does not weaken the gate. A stale read can only ever show
  something OLDER than reality; it cannot invent a session that was never
  stored. So disagreement means either "this event is stale" or "this read is
  behind", and only time separates them. A session-bearing event that
  disagrees is now re-read up to five times at 50ms before being dropped
  (`waitForStorageCatchUp`, lib/authBootstrap.ts). An event that is genuinely
  superseded disagrees on every attempt and is dropped exactly as before, and
  ordering is untouched -- a late replay still takes its ticket from the same
  write gate.

  **A SIGNED_OUT is retried on the same terms, and the first version of this
  fix wrongly excluded it (raised by Codex against `a7f6bb2`, and correct).**
  The reasoning given then -- that dropping a sign-out which is not ours is the
  safe direction -- confused "safe" with "correct". The propagation delay runs
  both ways: a REMOVAL is equally slow to become visible, so a tab sharing the
  session that was just ended reads it as still present, drops the sign-out for
  good, and goes on showing an authenticated workspace for an account that has
  signed out. Leaving a stale authenticated view is not the safe direction.
  Retrying cannot revoke a session this tab legitimately holds, because
  agreement for a sign-out means storage is EMPTY: if this tab's session really
  is still there, every attempt disagrees and the event is dropped exactly as
  before.

  Pinned by `tests/auth-slow-workspace/stale-storage-read.spec.ts`, which
  stages the propagation delay deterministically rather than waiting on a 1.7%
  race: this tab's reads of the auth record serve the previous value for the
  first few reads after another renderer's write. Reverted, the case fails with
  the tab making no requests at all. Two earlier versions of that staging
  passed with the fix reverted and were discarded -- one froze reads on a clock
  that had expired before the broadcast arrived, the other re-armed on every
  read so storage never caught up at all.

  The sign-out direction is pinned by a second case in the same file: this tab
  is parked on `/app/settings`, a second tab sharing the session signs out, and
  `Pull cloud` -- a control only a signed-in session renders -- must disappear.
  With `if (!session) return;` restored it fails on exactly that assertion. The
  first version of this case was parked on the reset screen instead, where the
  wording matched whether the sign-out had been processed or not, and it passed
  with the fix reverted; it was rewritten rather than kept.

  The natural reproduction was then re-run at the same size: **120 of 120
  passed**, against 2 failures in 120 before. That is consistent with the fix
  rather than proof of it -- at a ~1.7% rate a clean 120 is not conclusive on
  its own -- which is why the deterministic case above carries the weight.

- **A reset form that refused the customer in a loop and never expired. Now
  fixed.** `hasValidatedPasswordRecovery` compared the ACCOUNT a recovery was
  validated for and nothing else. auth-js keeps one stored session, so an
  ordinary sign-in for the same account -- from another tab, with the old
  password, because the reset email seemed not to arrive -- overwrites the
  recovery session, and it sends neither `SIGNED_OUT` nor `USER_UPDATED`, the
  only two events that release the marker. The account still matched, so the
  reset tab went on drawing an authorized form.

  It was a form that could not work, and measured rather than reasoned. With
  the grant comparison removed, a probe filled and submitted it three times
  against a replaced session:

  ```
  ATTEMPT 1 | formStillThere=1 | updateUserCalls=0   "This reset link has already been used. Request a new reset link."
  ATTEMPT 2 | formStillThere=1 | updateUserCalls=0   "This reset link has already been used. Request a new reset link."
  ATTEMPT 3 | formStillThere=1 | updateUserCalls=0   "This reset link has already been used. Request a new reset link."
  ```

  `updatePassword` derives the grant of the session it actually holds, finds
  the account marker still naming the RECOVERY generation, and reports the link
  as spent -- then declines to clear a grant it does not name, so the form does
  not retire either. Zero requests ever left the browser. The customer is left
  submitting into a loop whose only instruction (request another link) is
  attached to a claim about their link that is not what happened.

  The gate now compares the grant generation as well as the account
  (`src/lib/passwordRecovery.ts`), with the grant carried in store state so the
  screen re-renders when the session is replaced. Generations come from the
  `session_id` claim, which token rotation does not change, so this closes on a
  REPLACED session and not a refreshed one. Both ids must be known to disagree:
  a token carrying no `session_id` falls back to the account check exactly as
  before, rather than making recovery impossible on such a token.

  Pinned in both places. `tests/passwordRecovery.test.ts` gains the replaced-
  session case plus refresh and underivable-grant cases; `password-reset.spec.ts`
  gains a rendered case where a second tab signs in normally and the reset tab
  must show the refusal with no form. With the comparison removed the unit case
  and the browser case fail and the other 20 and 54 stay green.

- Not claimed: none of this was exercised against a live GoTrue or a live
  Supabase project. The browser suites intercept Auth and PostgREST, so what is
  established is the client's behaviour, not the server's.

## OCR and document ingestion, September 11, 2026

Measured through the real Create > Upload Document pipeline on rendered PNGs
(not `.txt` fixtures), reading the persisted workspace rather than the
Documents table -- that table is stage-filtered, so a document OCR failed to
match is simply not on screen and a naive check reads as "missing".

- **On-device Tesseract is more robust than the single clean fixture suggested.**
  The same certificate rendered four ways, extracted text and match:

  | rendering                                        | text extracted                         | matched |
  | ------------------------------------------------ | -------------------------------------- | ------- |
  | clean 64px black on white (the existing fixture) | complete                               | yes     |
  | 24px small type                                  | complete                               | yes     |
  | rotated 4 degrees                                | complete                               | yes     |
  | faded, grey #8a8a8a on #dddddd                   | complete                               | yes     |
  | 6% salt-and-pepper speckle                       | **nothing**, or a fragment on a re-run | yes     |

  Small type, mild rotation and poor contrast are handled. Heavy speckle is
  not, and is non-deterministic between runs. **Not established:** handwriting,
  real camera photographs, genuine scanner output, or scanned/mixed PDFs. Every
  fixture here is synthetic and should be read as a floor, not a grade.

- **Launch-blocking honesty defect: a document nothing was read from is
  reported as a confident success.** In the run where the speckled scan
  extracted nothing at all, the document was still recorded as
  `confidence=0.91`, `state=Ready`, attached to a horse. The mechanism is
  `xbarStoreHelpers.ts` in the create-a-horse-from-papers path:
  `confidence: Math.max(document.confidence, 0.91)` and `state: 'Ready'`,
  applied without reference to whether any text was extracted.

- **The number was also labelled as something it is not.** `Documents.tsx`
  rendered it as "% OCR confidence", but it is never an OCR measurement:
  `documentIntelligence.ts` types the worker as returning `{ data: { text } }`
  and discards Tesseract's own `confidence` entirely. The value is a
  horse-match heuristic --
  `max(match score, 0.48 + 0.07 x entityCount)`, floored at 0.42. A document
  with zero extraction and no match still scores 0.54. Measured directly:
  gibberish input and empty input both produce 0.54. The label now reads
  "match confidence", which is what the number is; **the 0.91 floor and the
  `Ready` state on an empty extraction are NOT fixed** and remain the real
  defect.

- **Entities are backfilled from the workspace and shown as extracted facts.**
  The same path fills `ownerName` from the horse record, which takes the
  workspace's default owner. Every document above reported
  `ownerName: "Thunder Horse Ranch"` -- the name typed during setup, absent
  from the certificate. The review UI offers "Apply facts" to write these onto
  a horse profile. Each document also reported `sex: "Mare"` although no
  fixture contains a sex word; that one is measured but not yet traced.

- **Partial processing is silent.** `readDocumentText` returns a bare string and
  applies every limit by truncation: `PDF_TEXT_PAGE_LIMIT` 8, `PDF_OCR_PAGE_LIMIT`
  3, `TEXT_PREVIEW_LIMIT` 12,000 characters. A 40-page scanned PDF is read to
  page 3 and nothing tells the customer. Nothing in the Documents UI mentions a
  page or character limit.

- **Scanned PDFs read nothing at all, in every current browser. Fixed.**
  Reproduced against a real three-page PDF built with pdf-lib -- a
  137-character transmittal cover sheet over two scanned pages carrying the
  registered name, registration number, sex and colour. Before: the upload
  extracted only the cover sheet and produced `entities: {}`. Two independent
  defects, either of which alone loses the document:

  1. The text-layer decision was made once for the WHOLE file --
     `MIN_TEXT_LAYER_CHARS` (60) measured across the first 8 pages _combined_.
     A cover sheet clears 60 on its own, so every scanned page behind it was
     skipped. The decision is now made per page: a page with no usable text
     layer of its own is OCR'd, within the existing 3-page budget, and a fully
     text-bearing PDF still does no OCR.
  2. **pdfjs-dist 6.2.108 calls `Map.prototype.getOrInsertComputed`**, a TC39
     proposal method that Chromium 141, Node 22, Safari and Firefox do not
     have. `page.render()` threw for every page
     (`PDF render failed for OCR (page 2)`), `renderPdfPageToCanvas` returned
     null, and the OCR loop skipped the page **silently**. So PDF-to-image OCR
     had never worked at all -- it was hidden because text-layer PDFs read fine
     and only scans came back empty. The fix imports the LEGACY pdfjs build,
     which ships the polyfill; same package, same version, no dependency
     change.

  After both: the scanned pages are read and the upload yields
  `horseName: "MIXED PDF MARE"`, `registrationNumber: "7788991"`,
  `sex: "Mare"`, `color: "Palomino"`. Each fix was reverted in turn and the
  regression fails without either, so neither is carrying the other.
  `tests/e2e/mixed-pdf-intake.spec.ts` pins it and runs in CI.

- **Partial processing is now disclosed. Fixed.** The limits are unchanged -- 8
  text pages, 3 OCR pages, 12,000 characters -- but they were applied by silent
  truncation, and the extractor returned a bare string with no way to say what
  it had skipped. A long scan was read as far as page 3 and the screen said
  nothing, so a sale packet could be built on a third of a file with no hint.
  The reader now reports coverage alongside the text, and a document that was
  not read in full carries a plain sentence on its row: "Only 3 of 6 pages were
  read. Facts on the parts that were not read are missing, not absent."

  A file read end to end says nothing at all, so silence keeps meaning
  "complete" rather than becoming noise. A failed read -- zero pages of nine --
  makes no page claim either: the empty extraction is the honest signal there,
  not a "0 of 9" that reads like a partial success. Both are pinned by unit
  tests on the pure description, each branch of which was neutralised in turn
  and breaks at least one case, and by a browser case uploading a six-page scan
  against the three-page budget.

## Follow-up September 11, 2026

- Account deletion now refuses unreadable ownership/membership results,
  unconfirmed ownership transfers and failed membership removal before deleting
  the auth account. Thirteen targeted tests (including the real handler with
  mocked service responses) and 1,120 unit/API tests passed. No real accounts or
  records were deleted for these checks.
- This does **not** close the shared-account deletion lifecycle: review changes
  to membership between planning and deletion, and storage retention/access
  after transferring a workspace. The endpoint now refuses shared-workspace
  owners before any mutation, rather than transferring the row and then deleting
  the departing user's whole Storage prefix. A reviewed handoff is required;
  automatic shared-workspace account deletion is not an available launch feature.
  Concurrent changes and files previously shared elsewhere remain open checks.
- Claude's `98f5655` removes inferred member deletion from stale saves and
  carries reset uncertainty explicitly. Claude also measured intermittent
  session/reload failures in the membership browser test; one passing battery
  does not establish repeatability. That failure was subsequently diagnosed to
  the service-worker reload and the cold-device setup guard -- see "Verified
  September 11, 2026" above -- and is no longer open.
- Visual review at 1440px and 390px used a local Professional-plan fixture,
  not a real paid account. Dashboard, Documents and Billing showed no horizontal
  overflow. Empty Documents now opens Upload for users who can upload, with a
  "No documents yet" status. Billing cards now show seat/document/storage limits
  once in the canonical feature copy and keep horse/packet limits separately.
  Service success
  and live premium entitlements were not established by this fixture.

## Verified September 10, 2026

- Applied `20260911005818_workspace_access_policies.sql` (September 11 UTC):
  a live authenticated workspace read had failed with policy recursion
  (`42P17`). After the fix, real SQL under the `authenticated` role passes
  owner creation/read/write, tenant isolation, member read-only access,
  Admin writes and owner removal. Self-enrollment and self-promotion are
  denied. Invitation acceptance now verifies the current confirmed account,
  consumes the pending invite atomically and applies its assigned role;
  wrong-recipient, unconfirmed, revoked and replay cases refuse. All synthetic
  users and records rolled back (one original auth user, zero workspace rows).
  Ten relational browser cases passed without retries, including the new
  client RPC path and preservation of member account bindings during saves.
  The latter test reproduced the old client's `user_id: null` write before
  the fix; saves now omit that column and the live SQL conflict update preserves
  the binding. Deploy the matching client before testing invitations;
  the old client no longer has permission to accept via direct table writes.
- Follow-up share fix applied at `20260911003739` UTC (September 10 Chicago):
  `20260911003739_share_release_selected_row.sql`. Reproduced a released sibling
  authorizing an unreleased draft with the same path before the fix. The live
  rollback test now passes: both resolvers refuse the draft and the tracker
  records no view. Token/public/archive controls still pass, fixture counts
  return to zero, and the legacy function remains unavailable to `anon`.
- Integrated the upstream auth-storage and sign-out changes through `5de5391`:
  all 1,113 unit/API tests and 50 auth smoke cases passed without browser
  retries. A subsequent reset-screen error-handling change passed three
  targeted browser cases, including no repeated mutation after a lock
  completion error. These browser tests use mocked Auth responses.
- Required browser locking passes the integrated auth smoke suite.
  Unsupported/denied locks send no password change. This intentionally limits
  reset availability in older browsers; it does not enforce single-use tokens
  at the GoTrue server.
- Independently ran the `e722979` candidate: 1,095 unit/API tests, 44
  built-bundle auth tests, and eight relational-sync-enabled held-workspace
  tests passed, with browser retries disabled. The browser suites intercept
  Supabase requests; they do not prove real email delivery or cloud sync.
- Applied the private-share migration to `xbar-records` (`uxvwfepyothlakhqazwv`),
  ledger version `20260910173613`. Both live functions reject empty stored
  private tokens; `shared_listings_private_token_present` is validated. No
  listings were present before or after the migration.
- Ran `supabase/checks/share-token-live-rollback.sql` against that live schema:
  empty private-token inserts rejected by the named constraint; missing/wrong
  tokens refused; valid private and public links resolved; archived links
  refused; only permitted views tracked. All fixture rows rolled back, with
  workspace/horse/listing/subscription counts confirmed back at zero. This
  checks deployed SQL behavior, not a browser checkout or customer login.
- Supabase's ledger already records the other five README rollout migrations
  as applied on September 4. Their data effects were not independently replayed.
- Production `/api/health` returned HTTP 200 and `billingReady: true`:
  Supabase admin, Stripe secret/webhook/price IDs and both managed-billing flags
  were present. This proves configuration presence, not credential validity,
  payment completion, or webhook delivery. Email-provider and reminder-cron
  flags were false; this email flag does not report Supabase Auth SMTP.
- The production alias still serves `5c38394e496088e4f8a98c434f3b1c7913f3b881`
  on `main`, not PR #212's `e722979` candidate. A green preview is not a
  production release of the auth fixes.
- Supabase's security advisor still reports leaked-password protection disabled.
  Site URL, real confirmation/recovery email delivery, and the complete
  signup → workspace → horse → checkout → webhook flow remain unverified.
  Browser dashboard access failed in this verification environment.
- Recovery-email attempt: the Auth API accepted one request (HTTP 200) and
  recorded `recovery_sent_at`, but the recipient reported no email received.
  Delivery and link completion remain unverified; acceptance is not delivery.
  Available Auth audit-log rows did not explain the missing message. Inspect
  Auth mail logs/SMTP configuration before repeating requests.
- The documented recovery concurrency residuals remain open; they have not
  been accepted as launch risks or closed by these checks.

## 0. Preflight — see what's configured before and after each step

```sh
npm run preflight                                                    # local env report
npm run preflight -- --url https://xbar-horse-management-app.vercel.app  # + live /api/health probe
```

The report lists every production subsystem (Supabase accounts/sync, Stripe
billing, email, cron, optional hardening), which env vars each one needs, and
what turning it on unlocks. The `--url` probe compares intent against the
deployed reality. Nothing here blocks a deploy — unconfigured subsystems
degrade honestly (manual-billing panel, local-only mode, in-app reminders).

**Billing launch note:** `VITE_MANAGED_BILLING_ENABLED` is the client-side
master switch. Leave it `false` (the app shows the honest manual-billing
panel) until _all_ Stripe values — secret key, webhook secret, and the four
price IDs — plus Supabase are configured in Vercel; then set it `true` and
redeploy.

## 1. Canonical domain

**Interim decision (July 2026):** the site canonicalizes to
`https://xbar-horse-management-app.vercel.app` — the domain actually attached
to the project — so canonicals, sitemap, JSON-LD, and robots.txt are all
truthful today. The origin comes from one place
(`SITE_ORIGIN` in `scripts/marketing/render.mjs`, overridable via the
`PUBLIC_SITE_ORIGIN` or `PUBLIC_APP_URL` env var), so moving to a custom
domain later is a config change plus redeploy.

When you attach a custom domain (e.g. `xbar.app`, currently registered —
confirm you own it):

1. Project → Settings → Domains: add the domain (+ `www.`) and set it primary.
2. Set `PUBLIC_SITE_ORIGIN=https://<domain>` in Vercel Production env vars and
   redeploy — every canonical, OG URL, sitemap entry, and robots.txt line
   updates automatically.
3. `vercel.json` already 308-redirects `www.xbar.app` → `xbar.app`; add
   equivalent host redirect blocks for any other alias.
4. Resubmit the sitemap in Search Console under the new property.

## 2. Search Console

1. Create a Domain property for `xbar.app` in Google Search Console
   (DNS TXT verification), or use the HTML-tag method by setting the
   `GOOGLE_SITE_VERIFICATION` environment variable in Vercel — the marketing
   generator emits the meta tag automatically on every public page.
2. Submit `https://xbar.app/sitemap.xml`.
3. Use URL Inspection on `/`, `/pricing`, and one resource page; request
   indexing.
4. After a week, check Coverage for accidental `/app` or `/profiles` URLs —
   they should all report "Excluded by noindex/robots".
5. Repeat property + sitemap in Bing Webmaster Tools.

## 3. Analytics and conversion events

- **Already wired, first-party, CSP-safe:** every marketing page loads
  `/site.js`, which beacons pageviews, sign-up CTA clicks, and sample-packet
  clicks to `/api/metrics` (anonymous — no cookies, respects Do Not Track).
  Events always appear in the Vercel function logs; once Supabase is
  configured they are also stored in `runtime_events` as `marketing.*` rows,
  queryable alongside the app's product events.
- If you later want a full analytics product, keep the CSP strict
  (`script-src 'self'`) and prefer a proxied/self-hosted endpoint
  (Plausible/Umami behind a first-party path) over extending the CSP for a
  third-party vendor.
- In-app conversion events (workspace creation, first document upload, first
  sale packet build) are already tracked via `src/lib/telemetry.ts` product
  events.
- Set up rank tracking for: "horse records software", "equine records app",
  "horse sale packet", "horse ownership transfer checklist", plus brand terms.

## 4. Customer proof (do not fake it)

- The marketing site intentionally ships without testimonials or case studies;
  a unit test blocks unverifiable social-proof claims.
- When the first real operation agrees **in writing**: publish
  `/customers/<name>` with concrete, verifiable specifics (horses managed,
  documents processed, before/after workflow), a named person, and a review
  date — then link it from the homepage and relevant solution page.

## 5. Authority (humans required)

- Recruit one named equine professional (DVM, registry veteran, or working
  sale-barn manager) to review the three resource guides; add their name,
  credentials, and "reviewed on" date to the article bylines.
- Offer the records checklist and transfer checklist to breed associations,
  boarding barns, and trainer networks as printable resources (they link, you
  earn authority).
- Only add comparison pages when every claim about a competitor can be
  documented and dated.

## 6. Post-deploy verification

```sh
curl -sI https://xbar.app/            # 200, HTML, cacheable
curl -sI https://xbar.app/app         # X-Robots-Tag: noindex
curl -sI https://xbar.app/login       # 308 -> /app/login
curl -sI https://xbar.app/horses      # 308 -> /app/horses
curl -s  https://xbar.app/sitemap.xml # marketing pages only
curl -s  https://xbar.app/robots.txt  # Disallow: /app
```

Then run Lighthouse (or PageSpeed Insights) against `/` and `/pricing` —
both are static HTML and should score high; regressions mean something broke
in the generator.

## 7. Auth launch gates — observed state, 9 Sep 2026

Observations read from the live `xbar-records` Supabase project
(`uxvwfepyothlakhqazwv`) on 9 Sep 2026 via the Supabase MCP, by one session
that has not been independently repeated. Nothing was changed. Each item below
names the query or advisor it came from so it can be re-run and disagreed with.

### Observed, with the evidence

- **No retained workspace, horse or subscription records.**

  ```sql
  select (select count(*) from auth.users) as users,
         (select count(*) from auth.users where email_confirmed_at is not null) as confirmed,
         (select count(*) from public.workspaces) as workspaces,
         (select count(*) from public.horses) as horses,
         (select count(*) from public.workspace_subscription_profiles) as subs;
  -- users 1, confirmed 1, workspaces 0, horses 0, subs 0
  ```

  This establishes that no such records are retained **now**. It does not
  establish the flow has never run — rows can be deleted. Either way, there is
  no stored evidence that signup → workspace → horse → tier → checkout has
  succeeded, so it still needs to be demonstrated before launch.

- **Leaked-password protection is disabled** — Supabase advisor
  `auth_leaked_password_protection`, security set. Authentication → Policies
  enables the HaveIBeenPwned check. It governs every password the reset flow
  sets, and turning it on is a single toggle.

- **RLS is enabled with at least one policy on all 25 public tables** (
  `pg_class.relrowsecurity` joined to `pg_policies`). That rules out the
  trivially-open case. It says **nothing about whether the policies are
  correct** — no policy body was reviewed here, and "RLS on" is not a security
  conclusion.

- **Advisor lints 0026/0027** flag those same 25 tables as visible in the
  GraphQL schema to `anon` and to `authenticated`. That is schema
  discoverability; row access is still governed by the policies above. Not a
  data-exposure finding on its own.

- **Two `SECURITY DEFINER` functions are `anon`-executable** (advisor 0028):
  `xbar_resolve_public_listing` and `xbar_track_public_share_view`. Deployed
  `proacl` confirms both carry `anon` and PUBLIC grants while
  `xbar_resolve_public_listing_legacy` carries neither — matching the intent of
  `migrations/20260822_restrict_anon_rpc_surface.sql`. Both are the buyer share
  flow and are meant to stay reachable. **The private-token fail-open was closed
  on this project on September 10 by
  `migrations/20260910173613_private_share_token_fail_closed.sql`** — see the current
  verification above. The file retains the historical explanation of the flaw.
  The migration leaves the constraint `NOT VALID` if older invalid rows exist;
  new inserts and updates are still checked and the patched RPCs deny those old
  links. The base schema defers validation. Reissue affected private links with
  owner authorization, or archive those listings, before validating separately.
  Archived listings are exempt from the token constraint and remain inaccessible
  through both public RPCs. Prefer archiving for any listing nobody intends to
  share again: re-issuing hands a broken share a working token on the way to
  retiring it, which is the one outcome this fix exists to prevent. Do not delete listings or make them public merely
  to pass validation.

### Not verified here — needs a person with a browser and the dashboards

This session could not reach these; that is a limitation of this environment,
not a claim that nobody can check them. Egress to
`xbar-horse-management-app.vercel.app` is refused by the agent network policy
(403 on CONNECT), and the tools available expose no auth-configuration or
Vercel environment read.

1. **Auth → URL Configuration → Site URL.** If it is still `localhost`,
   confirmation and recovery emails point at a machine the customer does not
   have. Set it to the deployed origin and add the preview-deployment origins
   to Redirect URLs, or links opened from a preview build are rejected.
2. **Send one real signup and one real recovery email.** Confirm they arrive
   (the default Supabase SMTP is rate-limited and is not a launch sender), that
   the link lands on `/app/reset-password`, and that setting a password works.
3. **Enable a provider in Supabase before listing it in
   `VITE_AUTH_OAUTH_PROVIDERS`.** The sign-in screen renders what that variable
   lists; a provider Supabase has not enabled becomes a button that fails.
4. **Stripe:** `VITE_MANAGED_BILLING_ENABLED` stays `false` until the secret
   key, webhook secret and all four price IDs are set — see section 0.

### Recovery consumption — design requirements, not implemented

Recorded so they are not mistaken for protections that exist:

- Password reset now requires a Web Lock. Missing or denied locking refuses
  without sending a change, including on safari13. The app no longer relies
  on its storage lease alone for exclusion. Server-side enforcement, direct
  bearer reuse, and requests surviving browser-context termination remain
  separate concerns; this is not a single-use-session guarantee.
- A server-side consumption row (`SECURITY DEFINER` RPC, RLS deny-all table,
  unique on the attempt) closes browser-side races only. **It does not make the
  recovery token single-use** — whoever holds it can call GoTrue's
  `PUT /auth/v1/user` directly.
- Nor does PKCE alone: the browser still exchanges the code and holds the
  resulting token. Only an architecture where the session stays server-side
  keeps a GoTrue-capable token out of the browser.
- The recovery **link** is already single-use at GoTrue: the OTP is consumed at
  `/verify`, so thoroughly that Supabase's own troubleshooting guide names
  email-prefetching scanners consuming it before the customer. What is not
  single-use is the **session token** minted from that one redemption.
- Requiring the `amr` claim to carry a `recovery` method is how a recovery
  attempt would be told from an ordinary session. Documented — Supabase's JWT
  Claims Reference enumerates `"recovery"` among the `amr.method` values — but
  **not yet observed on a real recovery token for this project**; item 2 above
  would settle it. The installed `@supabase/auth-js` types do not enumerate
  `recovery` and settle nothing either way.

The full design, with the three corrections a review raised against it, is in
[`docs/RECOVERY-CONSUMPTION-DESIGN.md`](RECOVERY-CONSUMPTION-DESIGN.md). It is a
design only: no migration, no endpoint, no cloud or configuration change.
