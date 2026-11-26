# Apple setup for the XBAR TestFlight candidate

Preparation only, November 26, 2026. Membership, team, app record and upload rights remain **unverified**. The two failed phone sign-in handoffs do not establish that anything is missing. Do not use the owner's existing browser, collect credentials, accept agreements, enroll, pay, or create duplicate records. Keep the [candidate worksheet](release-candidate-20261126.md) and [submission runbook](README.md) as the release evidence ledger.

## Resolve the existing account first

Through an authorized secure access path, record only non-secret evidence: eligible membership status, team ID, legal seller as displayed, app ID and exact bundle ID, operator role/app access, uploaded versions/builds and available signing executor. Do not put account credentials, identity documents, certificate keys or reviewer passwords in source or screenshots.

- **Eligible existing team and app:** reuse that team, `com.xbar.ranch` record and existing signing custody. Verify uploaded-build inventory before allocating a build number. A similarly named app is insufficient; match the bundle ID.
- **Eligible team, no matching app:** verify both Apps and Identifiers on the correct team before proposing creation. Account Holder/Admin can register the explicit identifier; Account Holder/Admin/App Manager can create the app record. If the identifier belongs elsewhere, resolve ownership with Apple rather than silently renaming XBAR. See [identifier registration](https://developer.apple.com/help/account/identifiers/register-an-app-id/) and [app record creation](https://developer.apple.com/help/app-store-connect/create-an-app-record/add-a-new-app/).
- **No eligible membership confirmed:** Erin must securely verify the account and select the actual seller/entity. If enrollment is required, identity verification, agreements and payment are owner actions. Individual/sole proprietor and organization enrollment have different seller/verification requirements; do not infer legal status from the XBAR brand. See [Apple enrollment](https://developer.apple.com/help/account/membership/program-enrollment/).
- **Agreement or role blocks access:** identify the exact Apple notice and required owner action. Do not accept terms, grant broad roles, or start a second enrollment as a workaround.

## Draft record, not submitted

| Field                                          | Prepared value or unresolved decision                                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Platform                                       | iOS, including the existing iPhone/iPad target                                                                                           |
| App name                                       | XBAR; availability not verified                                                                                                          |
| Bundle ID                                      | `com.xbar.ranch`; team ownership not verified                                                                                            |
| Primary language                               | Proposed English (U.S.); reuse existing value if present                                                                                 |
| SKU                                            | Proposed `xbar-ios`; check existing inventory before creation                                                                            |
| Team, seller and Apple numeric app ID          | Unknown; copy only verified account values                                                                                               |
| User access                                    | Limit app access to authorized operators; reuse existing access where suitable                                                           |
| Version/build                                  | Source `1.0 (1)` only; select after uploaded-build readback                                                                              |
| Support/privacy                                | Approved public origin plus `/support` and `/privacy`; protected preview is not a public submission URL                                  |
| Review contact/access                          | Existing support email `xbarje@gmail.com`; named reviewer contact and dedicated test credentials still require secure owner confirmation |
| Purchases/privacy/age rating/export compliance | Pending reviewed binary/provider facts; no answers submitted                                                                             |

Apple requires the Account Holder's current agreement before app creation. This draft neither creates a record nor authorizes accepting an agreement. Reuse an existing record before considering any new creation.

## Protected signing and upload configuration draft

Read-only GitHub environment inventory currently shows `github-pages`, `Preview`, and `Production`; no dedicated protected iOS signing environment was present. No environment, secret or role was changed.

Prepare a dedicated environment such as `ios-testflight` only under the applicable approval. Require a named independent reviewer, prevent self-review and administrator bypass, and restrict allowed refs to the reviewed release candidate. Pin the complete source SHA and verify its required checks/review threads before signing. Do not expose signing to pull-request code or `pull_request_target`. GitHub environment secrets are released only after configured protection rules pass; see [GitHub environment protections](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

| Configuration          | Required verified custody                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Non-secret identifiers | Apple team ID, numeric app ID, bundle ID, approved version/build and source SHA                                                                 |
| Distribution identity  | Existing distribution certificate/private key and matching App Store provisioning profile, or verified cloud-managed signing route              |
| Upload authorization   | Approved least-privilege App Store Connect key/role or authorized Xcode session; an API upload key alone is not a distribution signing identity |
| Runtime                | Approved reachable HTTPS backend, actual auth template and provider flags; never embed preview-bypass credentials or production service keys    |
| Secret handling        | Protected secret store, temporary keychain/workspace, no shell tracing or key output, cleanup on success/failure; no credential artifacts       |
| Evidence               | Signed archive and IPA hashes, entitlements/team/profile match, validation log, actual upload/processing result and tester destination          |

No executable upload workflow is enabled by this document. Retain the current unsigned CI and all quality gates. Prefer preparing a concrete signed artifact and validation evidence for the final approval decision; if access is missing, identify exactly which identity, profile, role or executor is unavailable.

## Tester eligibility and install route

An internal group can contain up to 100 App Store Connect users with app access. Confirm Erin's actual eligible account and intended group; an email address alone is not internal eligibility. Do not enable automatic distribution or invite others without the intended tester decision. See [internal testing](https://developer.apple.com/help/app-store-connect/test-a-beta-version/add-internal-testers/).

External testers need a separate group; Apple requires an internal group first, and the first external build receives TestFlight App Review. Do not create a public link or treat external beta review as authorized public App Store submission. See [external testing](https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers/).

After the authorized upload, record processing and actual group availability. The verified route is an eligible tester's TestFlight invitation followed by a successful installation of the recorded version/build on iPhone. No invitation, usable link, signed IPA or installation currently exists in this environment. Recovery is to withhold the failed build from testers and retain its artifact/error, without revoking credentials, creating duplicate apps or altering customer data.
