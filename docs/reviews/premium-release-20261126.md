# XBAR integrated premium release

Active milestone: Documents. Customer outcome: edit saved horse fields from Documents, choose approved records, inspect the buyer-safe preview, generate and retrieve actual sales-packet and ranch-report PDFs. This milestone is not yet ready for owner review.

Governing milestone standard: [section 26, exact reviewed policy commit](https://github.com/Thunderhorse891/XBAR/blob/6dbaaa3fb9b87749c045271449af9df520185ec2/docs/PRODUCTION-ENGINEERING-CONTRACT.md#26-xbar-milestone-completion-rule). Policy PR #419 is independent; no policy changes are included here.

## Source and integration

- Verified main: `6d548c4ccc7e19864566847774316b6b0a575ecd`.
- Verified production alias: `c81b03be9b9faed9aa4a0e8f1e45867aefd0ddc0`, READY. Production is unchanged by this work.
- Preserved #418 head: `93c071b41c20467e2d5d34511621e8d5eb13eab6`.
- Recovered Documents parent: `d0ad28233fb715fcdd903e8bd83ce4af3e2d132a`, from the Nov 25 review bundle.
- The working branch contains current main as an ancestor. It deliberately builds on recovered work rather than reimplementing it.
- Next integration inputs: #402 `4b65efcea0b265ad793b77e9006ee9972fea2836` (includes #396 `17d4f3c53c20143a1794ff2a301225ed73089980`) and #409 `d383a6821b2443cbdcbf01fa5b91fca23072b130`. Review and reconcile conflicts; do not substitute old complete files over newer fixes.

## Implemented, awaiting integrated verification

- Documents offers saved-horse editing, packet preparation and ranch reporting together.
- Packet preview displays the same allowlisted identity/sale/ownership projection used by generation, selected approved originals and saved ranch branding. Branding repair navigation retains the buyer draft and rechecks current release requirements.
- Device generation produces a saved PDF through the shared cloud PDF assembler. It retains exact originals and the interactive HTML inside the PDF; readable PDF/image originals are also appended as pages. The printed seal does not claim to authenticate the PDF. Existing historical HTML packets remain supported.
- Shared record controls have explicit accessible names, with descriptions separate from labels.
- Capital reconciles horse investment, all-time overhead and receipts pointing to absent horses. Existing queued files are separated from files awaiting review. PDF and CSV use the same model.
- PDF artwork remains in the masthead/footer; operational text is unobstructed.

## Full release scope retained

| Area                          | Required evidence                                                                                             | Current state                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Documents and actual PDFs     | UI edit/save/reload, approved selection, privacy, retrieval, every-page inspection, failure/retry             | In progress                                                                                 |
| Public site                   | Real phone/desktop screens, short clear entry, working product evidence                                       | Live baseline captured; implementation pending                                              |
| Free and pricing              | Distinct Free/trial, approved monthly catalog, client/server parity, persistence                              | Existing #402/#396 work identified; integration pending                                     |
| Billing                       | Isolated checkout/webhook/access/receipt failures and recovery                                                | Not verified; no charge or production mutation authorized by this ledger                    |
| Horse/ownership/care/breeding | Saved facts, source review, unknown outcomes, role restrictions and reload                                    | Existing #418 work preserved; integrated browser checks pending                             |
| Operations/financials/assets  | Useful mobile actions, honest arithmetic, repeatable save/export                                              | Full integrated review pending                                                              |
| Auth and account              | Supported providers, signup/session/re-login/recovery and failures                                            | Hosted and actual-device verification pending                                               |
| Backend                       | Tenant/role boundaries, durable writes, retries, storage and recovery                                         | Existing regressions preserved; integrated checks and isolated schema prerequisites pending |
| Release                       | One pushed integration PR, final-head CI and review, approvals, intended production SHA and safe verification | Not released                                                                                |

## Evidence and remaining work

Evidence directory on the selected Windows computer: `C:\Users\Erin0\xbar-review-20261126`.

- Live home, pricing and sign-in: actual 390px and 1440px captures. No production form was submitted.
- Original sample and recovered `d0ad282` PDFs retained separately from new outputs.
- Two added financial/queue regressions were observed failing before implementation. All 23 report PDF tests subsequently passed.
- Two device-PDF tests pass, including exact extraction of the original file and interactive HTML from the resulting PDF. These are synthetic unit fixtures, not proof of hosted delivery.
- The browser harness creates a fictional workspace through the UI, edits horse fields through Documents and checks them after hard reload. Ownership source originals and attestations are explicitly synthetic fixtures. Buyer generation uses the real local no-card Professional trial, not a paid-entitlement override.
- Current phone/desktop preview captures are progress evidence. Final outputs, retry/retrieval acceptance and exact-build working preview remain pending.
- Hosted signup/email, real device behavior, sandbox billing-to-access, named QA schema readiness and production rollback are not established.

Next action: complete the application download/reload/retrieval and every-page PDF review, then reconcile the Free/pricing and existing visual branches into this one candidate and run the full configured checks. Do not describe this checkpoint as a completed premium release.
