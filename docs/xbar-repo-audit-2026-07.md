# XBAR Repository Audit — July 2026

Full-repo audit: every file tree walked, typecheck / lint / unit tests / production build / dependency audit all executed on a clean checkout, API layer reviewed, docs compared against actual code state, open PRs reviewed.

## Verified healthy (ran, not assumed)

| Check                    | Result                                                                                                                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tsc --noEmit`           | 0 errors                                                                                                                                                                                  |
| `eslint .`               | 0 errors, 5 warnings                                                                                                                                                                      |
| `npm test` (30 suites)   | all pass                                                                                                                                                                                  |
| `npm run build` (Vite 8) | clean build in ~5s                                                                                                                                                                        |
| `npm audit` (prod + dev) | 0 vulnerabilities                                                                                                                                                                         |
| CI pipeline              | lint, format, audit, typecheck, tests, build, browser smoke test, CodeQL, Dependabot — genuinely comprehensive                                                                            |
| API hardening            | per-IP rate limiting, constant-time cron auth, Stripe webhook idempotency, zod body validation, CORS on browser endpoints, health probe — the recent hardening PRs are real, not cosmetic |
| Weather                  | real Open-Meteo integration (geocoding + forecast), not mocked                                                                                                                            |
| OCR                      | client tesseract.js + optional AWS Textract SigV4 server path                                                                                                                             |
| Email                    | pluggable Resend/SendGrid with graceful in-app fallback                                                                                                                                   |

---

## CRITICAL

### 1. Fake action buttons on core product surfaces — they claim success and save nothing

~16 buttons across the "care/ranch" routes fire a **success toast without writing any data**. The worst offenders literally tell the user a record was saved:

- `src/routes/AnimalProfile.tsx:105,206,283` — "Add Health" → toast **"Health record added"** (nothing added); "Move" → "Move drawer opened" (no drawer exists); "Add Breeding Record" → "Breeding record added" (nothing added)
- `src/routes/HealthCare.tsx:114,117` — "Schedule Care" / "Add Health Record" → toast only
- `src/routes/Equipment.tsx:43,117,120` — "Create Work Order" / "Log Repair" → toast only
- `src/routes/BreedingFoaling.tsx:83` — "Preg check scheduled" → toast only
- `src/routes/FeedInventory.tsx:40` — "Log Feed" → toast **"Feed logged"** — nothing logged
- `src/routes/Pastures.tsx:56,105` — "Report Issue" / "Move Horses" → toast only
- `src/routes/TodayWork.tsx:189,215` — **Snooze is fake**: toast "Snoozed", task state never changes, task reappears

For a paid product this is the most damaging class of defect: users believe health records, feed logs, and work orders were saved. Either wire these to the store (the store logic already supports most of these mutations) or remove the buttons until they work.

### 2. Delete-protection migration is orphaned and never applied

`supabase/20260525_block_relational_mirror_deletes.sql` (blocks destructive deletes on cloud mirror tables) sits **outside** `supabase/migrations/`. `scripts/prepare-supabase-schema.mjs` only reads `supabase/migrations/*.sql`, so `npm run supabase:prepare` — the documented production bootstrap path — silently omits it. Unless someone applied it by hand, production has no delete guard. Move it into `supabase/migrations/` (or delete it if superseded).

---

## HIGH

### 3. Two test suites exist but are never run

`tests/alertCenter.test.ts` and `tests/documentTemplateLibrary.test.ts` compile and pass, but are missing from the hand-chained `npm test` command, so CI never runs them. This is the predictable failure mode of the current test script (see #7).

### 4. Open PR backlog — 15 PRs, two of them yours to merge first

- **#159** — ZIP decompression bomb guard (security) — review and merge
- **#160** — removes the orphaned `web/` prototype — review and merge (see #5)
- **13 Dependabot PRs**, including majors: react-router-dom 7, TypeScript 6, pdfjs-dist 6, eslint/js 10, React bump, @types/node 26, and 4 GitHub Actions majors. Majors need individual verification; the grouped minor/patch PRs (#149, #150) are the easy wins.

### 5. `web/` — an entire second frontend that is dead code

`web/` is a Next.js 14 prototype (~90 files, own package.json/lockfile) that runs **entirely on mock data** with fake auth ("any email + 8-char password"). Nothing in the shipping app references it; last touched via PR #82. It bloats the repo, confuses contributors and CodeQL, and its README describes a product that doesn't exist. PR #160 already deletes it — merge it.

### 6. Dual persistence paths still live in production config

`.env.production` ships `VITE_SUPABASE_SNAPSHOT_FALLBACK=true` — the snapshot-era sync path the repo's own checklist (`docs/production-upgrade-checklist.md`) says should be removed from the main path. Two write paths to cloud state is a standing data-consistency risk; finish the relational migration and retire the fallback flag.

---

## MEDIUM

### 7. `npm test` is a 30-command `&&` chain in package.json

Every new test file must be manually appended or it silently never runs (#3 is the proof). Replace with `node --test .codex-test-dist/tests/` or a runner (vitest) so discovery is automatic.

### 8. E2E coverage is thin relative to the revenue surface

One real e2e spec (`workspace-setup`, 164 lines) plus prod-smoke checks. Zero browser coverage of: Stripe checkout redirect flow, invite acceptance, buyer inquiry → response loop, document upload → OCR → review pipeline, sale packet generation. These are exactly the flows that back the pricing page.

### 9. Dead code and repo litter

- `src/routes/Plans.tsx` — unrouted (billing uses `Subscriptions.tsx`); only a test imports it
- Root `build.ps1` / `setup.ps1` **differ** from `scripts/build.ps1` / `scripts/setup.ps1` — two diverged copies of each, one pair is stale
- `Horse_export.csv` — sample data committed at repo root
- PR #159 also covers some of this hygiene

### 10. Lint warning that is a real bug class

`src/routes/BuyerDealRoom.tsx:66` — `useEffect` missing `selected` dependency (stale-state risk on the deal room panel). The 4 fast-refresh warnings are cosmetic.

### 11. Rate limiting is per-instance unless Upstash env vars are set

By design it degrades to in-memory counting per serverless instance. Fine as a fallback, but confirm `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` are actually set in Vercel prod, otherwise the limits are largely decorative under load.

---

## LOW

### 12. Mobile is scaffold-only

Capacitor 8 is configured and scripts exist, but no `ios/`/`android/` projects have ever been generated or committed. The roadmap's "mobile field execution" pillar is 0% shipped. Fine — just don't market it yet.

### 13. CSS system sprawl

15+ route-level stylesheets from successive redesigns all load globally in `App.tsx`: `xbarCommandSystem.css`, `metalBrandSystem.css`, `commandCenterLocal.css`, `premiumOperatingSystem.css`, `premiumSaasExperience.css`, `productionFinal.css`, plus per-route "experience" files. It works, but overrides stack in load order and every redesign layer is still shipping. Worth consolidating into tokens + per-route scoped styles before the next visual pass.

### 14. Structure inconsistencies

- `src/pages/` contains exactly one file (`Dashboard.tsx`); everything else lives in `src/routes/` — pick one
- Node engines pin `>=20.19` but CI runs Node 24 — align (bump engines or pin CI to the supported floor)
- `docs/` mixes engineering docs with marketing/strategy (sales copy, interview pack, positioning); the production checklist is partially stale (items done but unchecked, items unchecked but abandoned)

---

## Suggested attack order

1. Fix or remove the fake buttons (Critical #1) — highest user-trust damage per hour of work
2. Move the orphaned SQL into `migrations/` and re-run `supabase:prepare` against prod (Critical #2)
3. Merge #160 (delete `web/`) and #159 (zip guard), then batch the Dependabot minors
4. Add the two orphaned tests to the runner — or better, fix the runner (High #3 / Medium #7)
5. Verify Upstash env vars in Vercel prod (Medium #11)
6. Retire the snapshot fallback path (High #6)
7. E2E specs for checkout, invites, and the document pipeline (Medium #8)
8. Dead-code sweep: `Plans.tsx`, duplicate PS1 scripts, stray CSV (Medium #9)

---

## Remediation status (branch `claude/xbare-repo-audit-5sqb5u`)

| Finding                                                                      | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #1 Fake action buttons                                                       | **Fixed.** Quick-create moved into `useUiStore` (`openCreate`/`closeCreate`) so any surface can open a prefilled flow. All drawer flows now persist real data: health → `addMedicalEvent`, breeding (new flow) → `addBreedingEvent`, move → `updateHorseLocation`, equipment → `addRanchAsset`, buyer follow-up → `createSalesLead`, document upload → real file input into `createDocumentIntake`. Flows with no backing entity ('Add Task', 'Report Pasture Issue') were removed instead of faked. Equipment work-order/repair buttons now drive real `updateAsset` transitions. Care Tasks done/snooze persist per calendar day in localStorage. |
| #2 Orphaned delete-protection migration                                      | **Fixed.** Moved into `supabase/migrations/`; `npm run supabase:prepare` now emits the guard triggers into the generated schema. Re-apply the generated schema in production.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| #3 Orphaned test suites / #7 fragile test chain                              | **Fixed.** `npm test` now uses `node --test` glob discovery — 171 tests run (up from the chained subset), including `alertCenter` and `documentTemplateLibrary`. New test files are picked up automatically.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| #9 Dead code                                                                 | **Fixed.** Removed unrouted `src/routes/Plans.tsx`, stale `scripts/build.ps1` / `scripts/setup.ps1` (hardcoded `C:\Program Files` paths; root versions are canonical), and `Horse_export.csv`.                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| #10 BuyerDealRoom effect warning                                             | **Resolved.** The id-only dependency is intentional (a full `selected` dependency would clobber in-progress offer drafts on background sync); documented with a targeted disable.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| #4 PR backlog, #5 `web/`, #6 snapshot fallback, #8 E2E coverage, #11 Upstash | Open — require PR merges, a production env check, or larger migrations outside this branch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
