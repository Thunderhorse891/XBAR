# XBAR integrated premium release

Active delivery milestone: **installable TestFlight release candidate**, reprioritized by Erin after the Documents checkpoint. Preserve and integrate the Documents implementation under the existing review gates. The full website, signed-in application, mobile experience, generated documents, billing, and backend reliability remain in scope. Neither Documents nor the native candidate is declared release-ready.

Governing standard: [section 26 at the exact policy commit actually read](https://github.com/Thunderhorse891/XBAR/blob/6dbaaa3fb9b87749c045271449af9df520185ec2/docs/PRODUCTION-ENGINEERING-CONTRACT.md#26-xbar-milestone-completion-rule). Policy PR #419 remains independent and open; its policy is neither merged nor duplicated here.

## Source and integration

- Verified main: `6d548c4ccc7e19864566847774316b6b0a575ecd`.
- Last verified production alias: `c81b03be9b9faed9aa4a0e8f1e45867aefd0ddc0`.
- Preserved #418: `93c071b41c20467e2d5d34511621e8d5eb13eab6`.
- Recovered Nov 25 Documents source: `d0ad28233fb715fcdd903e8bd83ce4af3e2d132a`.
- Integrated #402: `4b65efcea0b265ad793b77e9006ee9972fea2836`, including #396 `17d4f3c53c20143a1794ff2a301225ed73089980`.
- Integrated #409: `d383a6821b2443cbdcbf01fa5b91fca23072b130`.
- Candidate branch: `codex/xbar-premium-release-20261126`. The main and all four open PR heads were reread and unchanged during this work.
- Evidence checkpoint: `103e5eba3aecefee83f192053d7bc2c88772ac3e`, clean when captured. Subsequent copy/readiness corrections require final verification before pushing.
- Remote candidate bootstrap remains at #418 until the normal push gates pass. No force push, merge, production deployment, migration, or payment was performed.

## Implemented

- Documents connects actual horse-field editing, approved-record selection, retained buyer/branding drafts, preview, PDF generation, and saved retrieval.
- Editing a horse from Documents now retains that screen and its filter instead of sending the user to the horse profile. The browser regression first failed on the old redirect; reload assertions wait for durable writes and the visible screen.
- Add Horse requires an intentional sex and record-group choice; a name alone cannot silently become a mare in Sale Prep. Validation retains the draft.
- The device buyer PDF contains the buyer-safe summary, selected readable source pages, exact original attachments, and interactive HTML. Its printed seal does not claim to authenticate the PDF. Existing historical HTML remains supported.
- Workspace branding is validated and used in previews and PDFs. Bundled XBAR artwork is the deliberate fallback. Server PDF routes use the same artwork with explicit file tracing; hosted bundle verification remains pending.
- Saved packet rows stay readable and expose usable download controls on phones. Identity changes cancel stale downloads.
- Report page 1 presents capital, asking value, potential margin, recorded monthly average, ready/blocked value, reconciliation, and next actions. Exception and economics tables retain all rows. Unallocated overhead and unmatched horse receipts reconcile; absent months and missing costs remain unknown. Queued files and files awaiting review are distinct. Additional actions use available page space before adding sheets.
- Public entry heroes have concise copy and one primary action. Free is distinct from the optional trial. Approved monthly rates come from the shared integer-cent catalog; new annual sales remain unavailable. Existing account-pinned checkout, protected issuance, private-record, care, breeding, and storage safeguards are preserved.

## Retained evidence

Selected computer directory: `C:\Users\Erin0\xbar-review-20261126`.

- `checkpoint-103e5eb`: immutable checkpoint copies of four actual app PDFs and six actual UI captures. Buyer packets have five pages; ranch reports have three. All sixteen pages and six screenshots were personally inspected. The phone viewport is emulated 390x844 in real Windows Chrome; desktop is 1440x1000. These are synthetic device workspaces.
- `documents-explicit-fields`: original downloaded PDFs, including byte-identical retrieval copies. `checkpoint-103e5eb/application-output-manifest.json` retains original paths/hashes and delivered-copy hashes. Library may add provenance metadata to delivery copies; extracted page text and page counts were checked against the originals.
- `checkpoint-library-identities.json`: successful Library IDs and versions for two PDFs and six screenshots. All eight saves succeeded.
- `documents-explicit-fields.log`: **2 browser cases passed in 3.9 minutes**, using `npx playwright test --config C:/Users/Erin0/xbar-review-20261126/documents-final.config.mjs --output C:/Users/Erin0/xbar-review-20261126/documents-explicit-fields` with Node 24.
- The browser flow creates the workspace through the UI, rejects unchosen horse facts, edits/saves/reloads actual fields, starts the actual local Professional trial, retains buyer/selection state through branding repair, generates and downloads both PDFs, verifies exact originals and HTML hashes, and retrieves identical bytes after reload.
- Approved original PDFs and ownership-review attestations are explicitly programmatic synthetic fixtures. This is not registry/veterinary proof, human-review acceptance, hosted signup, paid checkout, or a backend mock presented as cloud success. Browser requests are restricted to loopback/blob; providers and dotenv are disabled in the review server.
- The missing-file case deletes only the generated synthetic packet's device file, reloads, and checks an error, preserved packet row, re-enabled action, and no download. Its checkpoint message guessed a different device; the follow-up changes that to an honest unavailable-file message.
- `comparison-screens`: actual before/after Documents views against recovered `d0ad282`, using a separate two-document synthetic inventory fixture. `live-*.png` are the actual live public baseline captures; no production form was submitted.

## Verification and current defects

- The portable canonical `npm test` completed all **206 configured steps** without removing or reordering the original checks. Final-head validation is still required after subsequent changes.
- **26** report PDF regressions passed, including large registers, long names, missing data, financial reconciliation, logos, and layout bounds.
- **70** controlled server/API regressions passed with Supabase/storage fixtures; this does not establish hosted provider delivery.
- Explicit horse-fact validation passed its focused form regressions.
- App/test type checks, formatting, and lint previously passed (zero lint errors, four existing warnings); repeat for final source.
- The built browser suite completed **111/115**: two failures required shared-storage disclosure in the shortened pricing lead, and two followed the tour's retired action names. Both corrections are prepared; rerun before claiming a pass.
- The 239-case development-browser suite was started and interrupted for resource contention. Uncompleted cases remain unverified.
- Readiness wording/counts are being reconciled with packet preparation: retain the computed thresholds and release checks, show current source reasons, and exclude private types from the buyer-record count. The checkpoint's old `Reach 85 to generate` wording must not be treated as final.
- Follow-up focused checks: **72 passed** across local-file persistence, computed readiness, and marketing. Full app/test type checks, lint (zero errors, four existing warnings), and repository formatting passed. Subsequent editor-return changes require final browser and source verification.
- Browser reruns retained under `documents-readiness-final`, `documents-hydration-final`, and `documents-return-final` are failed/incomplete attempts, not acceptance evidence. The first revealed an early hydration read, the next reproduced the unwanted editor redirect, and network traces confirmed timestamped HMR and bare-path imports could instantiate separate stores. The dedicated synthetic review server was restarted without changing protection or persistence behavior before the next acceptance run.
- Clean-server acceptance: **2 passed in 3.4 minutes**, at 390px and 1440px, including retained Documents context after editing, persisted values, four buyer-safe reviewed records excluding the private sentinel, honest outstanding Coggins, real PDF downloads, byte-identical reopening, and honest missing-file recovery. Command: `npx playwright test --config C:/Users/Erin0/xbar-review-20261126/documents-final.config.mjs --output C:/Users/Erin0/xbar-review-20261126/documents-clean-server-final`. Outputs and log are retained outside the original immutable checkpoint.
- Follow-up canonical `npm test`: **all 206 configured steps passed**, log `final-head-npm-test.log`. The local production build passed (`final-local-build.log`). Built browser rerun and native acceptance remain outstanding.

## TestFlight preparation and native recovery

- Existing project: `ios/App/App.xcodeproj`; scheme `App`; identity `com.xbar.ranch`; current source version **1.0 (1)**. Do not allocate a new build number until the existing App Store Connect record and uploaded build inventory are verified.
- Existing canonical submission runbook: [ios-submission/README.md](../../ios-submission/README.md). It explicitly separates unsigned CI, actual-device acceptance, privacy review, signing, and distribution. The native workflow is `.github/workflows/ios.yml`, using a standard hosted macOS runner with synthetic provider configuration and no account submission.
- Latest inspected native run: [45077133941](https://github.com/Thunderhorse891/XBAR/actions/runs/45077133941), exact source `93c071b41c20467e2d5d34511621e8d5eb13eab6`, failed on November 22 in **Exercise the real WKWebView in iOS Simulator**. The retained accessibility tree contains a WKWebView and scrollbar but no email control; the step timed out. The result bundle did not finalize, and no screenshot artifact was retained. This is not a verified control fix or a signed build.
- The connected execution environment is Windows; no Mac is currently listed. GitHub repository secret/variable name inventories were empty. These checks establish no local Xcode or repository signing setup; they do not establish Apple membership or App Store Connect permissions.
- Read-only App Store Connect browser inspection was stopped on detected user interaction with the existing browser. No membership, app record, roles, signing credentials, uploaded builds, or install route has yet been verified. No duplicate app record, purchase, provisioning change, or upload was made.
- Next native action: retain a fresh native reproduction on this integrated source, capture simulator screenshots independently of a possibly unfinished xcresult, inspect the actual native failure, then correct its responsible code and rerun the unchanged behavioral gate. Actual iOS sign-in/session, persistence, intake/PDF/open/share and account controls, privacy disclosures, support links, reviewer access, and compliant subscription behavior remain distribution gates. TestFlight upload requires the applicable access and separate approval gates; public App Store submission remains outside this authorization.

## Hosted QA prerequisite

Read-only inspection of isolated QA `locqirqagzvpaekjmivd` confirmed a Starter default, no `workspace_upload_reservations`, and no `upload_project_budget`. Protected `xbar_issue_sale_packet(p_delivery jsonb, p_seal jsonb)` is present. No hosted generation was attempted against that incomplete setup, and no schema writes were attempted.

The prepared dependency sequence is:

1. `20261112120000_distinct_free_tier.sql`
2. `20261112130000_storage_object_accounting.sql`
3. `20261112140000_reserved_storage_uploads.sql`
4. `20261112150000_project_storage_budget.sql`

These require their existing review/approval and disposable-database checks. QA also needs QA-only `SUPABASE_SERVICE_ROLE_KEY` and server S3 endpoint/region/access credentials, bucket CORS, actual provider tests, and recovery/drain evidence. Do not substitute production credentials or apply direct-write restrictions before the replacement path is ready. Preserve unresolved reservations and original objects in recovery. See [reserved upload release contract](../RESERVED-STORAGE-UPLOADS.md).

The candidate branch's preview configuration points to QA. Server secrets/storage credentials are blank; billing, outbound mail, and unverified social providers are disabled. Production configuration/data remain untouched. An exact-candidate hosted preview is still pending final checks and source push.

## Full release scope retained

| Area                             | Completed source/evidence                                                                      | Remaining release evidence                                                         |
| -------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Documents and PDFs               | Real saved-field, preview, download/reload, privacy, and missing-file cases; inspected PDFs    | Follow-up verification and exact-head hosted QA                                    |
| Public website                   | Live baseline, integrated existing artwork, shorter entry, honest Free/pricing                 | Final built browser rerun and current before/after captures                        |
| Auth and account                 | Existing supported-provider and recovery safeguards preserved; QA provider flags withheld      | Hosted signup, confirmation, session/re-login, recovery, provider configuration    |
| Billing                          | Shared catalog, account-pinned checkout, legacy pricing, duplicate-purchase protection         | Isolated provider checkout/webhook/access/recovery; no charges authorized here     |
| Horse, care, breeding, ownership | Existing source-preserving and unknown-outcome corrections integrated; intentional horse entry | Complete affected browser journeys and role/reload checks                          |
| Operations, money, assets        | Integrated workflows and truthful report model                                                 | Remaining mobile/desktop save/edit/export acceptance                               |
| Backend and storage              | Reserved upload/recovery and protected issuance source integrated                              | Approved isolated schema/provider prerequisites, tenant/role and race verification |
| Mobile/native/accessibility      | Phone Chrome viewport and keyboard/layout checks; existing iOS safeguards                      | Real physical iOS/Android/Safari journeys and final accessibility review           |
| One integrated release           | All existing branch ancestry retained in one candidate                                         | Pushed exact-head PR/preview, required CI/reviews, approvals and rollout decision  |

Next action: preserve the verified Documents changes in the integrated candidate and prioritize native sign-in recovery and TestFlight preparation. Keep the remaining built-browser and hosted QA work open; do not close Documents or describe this checkpoint as a completed premium release. No production deployment, merge, migration, customer setting/data change, charge, or public submission is authorized by this handoff.
