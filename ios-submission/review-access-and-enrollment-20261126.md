# Review access and legitimate progress while enrollment is blocked

This is preparation, not an account action, App Review submission or approval. The active milestone remains an installable TestFlight candidate under [section 26](https://github.com/Thunderhorse891/XBAR/blob/6dbaaa3fb9b87749c045271449af9df520185ec2/docs/PRODUCTION-ENGINEERING-CONTRACT.md#26-xbar-milestone-completion-rule). See the [release worksheet](release-candidate-20261126.md) and [production checkpoint](web-release-checkpoint-20261126.md).

## Available paths

| Path                                    | Verified / attempted                                                                                                                                      | Boundary and next step                                                                                                                                                                                                                                                                                                |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iOS Simulator                           | Actual Xcode 26.6/iOS 26.5 control case passed on `f3e2e41`, run 45902871823; unsigned device compile also passed                                         | Signing-independent simulator QA can continue. The synthetic `.invalid` backend cannot establish auth, cloud retrieval or server deletion. Simulator evidence is not physical-device acceptance or a distributed binary.                                                                                              |
| Personal Team on Erin's own iPhone/iPad | Eligibility, Mac/device availability and signing are unverified; not attempted                                                                            | Apple permits Xcode testing using a Personal Team when eligible, with periodic reprovisioning and capability limits. This requires Erin's own authorized Xcode sign-in and device access, not TestFlight/App Store rights. No Apple session, identifiers, credentials, agreements or signing settings were changed.   |
| Safari Home Screen web app              | Source has `public/site.webmanifest`, `/app` start URL, standalone display, supplied icons and a service-worker path. Actual production page responds 200 | Apple supports Safari Share → Add to Home Screen → Open as Web App. Actual XBAR installation, offline behavior and retained sessions on Erin's device remain unverified. Use the verified public origin, not inaccessible `xbar.app` or a protected preview. This is web access, not the unreleased native candidate. |
| TestFlight/App Store                    | Blocked pending verified eligible membership, app/team/role, signing/upload access, remaining product evidence and approvals                              | Do not treat Personal Team, an unsigned `.app`, a PWA or alternate Apple ID as a distribution workaround.                                                                                                                                                                                                             |

Official sources checked November 26: [Apple developer account and Personal Team limits](https://developer.apple.com/help/account/basics/about-your-developer-account), [program enrollment](https://developer.apple.com/help/account/membership/program-enrollment/), [Simulator/device testing](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices), [Safari web app installation](https://support.apple.com/guide/iphone/iphea86e5236/ios). Apple currently states Personal Team limits of ten App IDs, three devices and three installed apps per device, with seven-day expiry/reprovisioning. Eligibility for this account has not been inspected.

## Concrete isolated reviewer path — not provisioned

Prerequisite: name the explicitly authorized non-production backend and confirm its schema/auth/storage prerequisites in the release ledger. No migrations, production data or entitlements may be changed by this plan. Do not provision against a guessed project or route native review traffic through a protected preview token embedded in the app.

1. Verify the approved backend is reachable from the bundled native origin; validate auth redirect/CORS, email template containing confirmation URL and token, private storage, quotas and deletion receipts using approved fixtures. Record configuration identifiers without secrets.
2. Use an owner-approved dedicated QA mailbox, a stable review password and the approved secure credential channel. Create one isolated `XBAR App Review Ranch` workspace with the actual Admin role. Keep the owner's login independent. No account has been created here.
3. Populate a clearly fictional horse, complete horse/packet fields, three synthetic original PDFs, explicit synthetic review attestations, one private sentinel document and a saved workspace logo. Unknown medical/legal/financial facts remain unknown. Keep a blocked horse as well as an authorized ready fixture. Establish any Professional QA entitlement only by the approved operator procedure after the billing-model decision; never imply a charge, trial, purchased entitlement or Apple product exists.
4. With a second authorized disposable account, exercise tenant refusal and a real supported restricted role selected from the permissions model (for example Sales Lead or Medical Lead); do not invent a Viewer role. Verify server readback of refusal and saved values.
5. On a fresh Simulator install of the exact candidate, retain clean-entry evidence, real sign-in, setup/intake, confirmed save, terminate/relaunch, cloud retrieval, offline refusal/recovery, actual PDF bytes, open/share/cancel, and missing-original behavior. Repeat on actual authorized iPhone/iPad and label that evidence separately. Browser reload is not native relaunch.
6. Account deletion requires a specifically disposable account on that authorized backend. Capture pre-delete account/workspace ownership, both UI entry points, shared-workspace refusal, successful deletion only where eligible, then independent server readback and cleanup receipt. Do not delete or claim deletion of a production/owner account or a mocked server response.

Private delivery block (fill only after verification; never commit actual credentials):

```text
Review backend/origin: [UNVERIFIED]
Exact binary SHA / version / build: [UNVERIFIED]
Dedicated reviewer email: [PRIVATE SECURE CHANNEL]
Password: [PRIVATE SECURE CHANNEL]
Workspace / role / approved entitlement: [UNVERIFIED]
OTP fallback and monitored delivery contact: [UNVERIFIED]
Clean-install verification date / device / evidence: [UNVERIFIED]
Deletion-only disposable account and server receipt: [UNVERIFIED]
```

## Draft App Review notes — hold until facts are verified

XBAR manages horse records, ownership evidence, care, expenses and buyer documents. The supplied reviewer workspace contains labeled synthetic records and originals. Sign in using the private review credentials, open Documents, edit the fixture horse, select approved buyer-safe records, preview and generate the sales packet, then open/share the resulting PDF. The ranch report summarizes recorded economics and unresolved exceptions. Follow the verified step-by-step path and fixture names supplied with the final binary. Do not claim this paragraph is tested until the real reviewer route above passes.

Supply the actual reachable support/privacy URLs, offline limits, deletion entry points and approved billing/access model. Native screenshots must come from the actual candidate; the earlier clipped/clock-overlap login captures are defect evidence, not store metadata. Do not describe a web-only Stripe flow as native purchasing or promise a StoreKit restore button that does not exist.

Queued response for guideline 2.1: identify the exact rejected build and reviewer's reproduced steps, supply a working dedicated review account and reachable approved backend, attach exact-binary clean-install journey evidence and explain the correction. **Pending**: no rejection, credentials, binary or completion is claimed.

Queued response for guideline 4.2: explain and demonstrate the actual horse/document workflow, reviewed original retrieval, on-device retained records and native Filesystem/Share behavior with exact-binary evidence. Answer the specific review finding without claiming architecture alone establishes compliance. **Pending**: actual full native journey and App Review finding.

## Apple Support escalation — prepared, not sent

Subject: **Enrollment blocked: Your enrollment in the Apple Developer Program could not be completed at this time**

The enrollment screen displayed: “Your enrollment in the Apple Developer Program could not be completed at this time”. No reason was supplied. Please identify the specific reason, including whether it relates to payment status, identity verification, a duplicate/prior enrollment, eligibility or country/region. What exact correction is required, and what legitimate enrollment or appeal route applies? Please provide a case number and expected next-response timeframe. We do not want to create a duplicate account, enrollment, app record or charge.

Private owner-completed checklist: Apple Account identifier; attempted enrollment type (individual/organization); country/region; attempt dates/times; original screenshot; two-factor status; legal-name/entity matching; Enrollment ID if present; prior attempts, actions and any existing case number. **Unknown until supplied/verified**. The historical March 2025 payment-outstanding attempt does not establish current payment or membership status. Never include passwords, verification codes or full payment/card details. Use [Apple Developer Support](https://developer.apple.com/support/) and its authenticated contact route only when Erin chooses to send this. No account access or support contact occurred here.

## Conditional dates

If eligible enrollment clears November 27, the earliest next work is team/app/role inventory and authorized signing preparation that day, alongside exact-candidate QA. Archive validation and any approved upload can follow only after access, product/privacy/billing evidence and review gates pass. Apple processing, external tester review and reviewer responses have no guaranteed completion date. No signed, uploaded, submitted or installable build is claimed.
