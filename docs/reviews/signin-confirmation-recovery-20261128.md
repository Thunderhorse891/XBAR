# Unconfirmed-email sign-in recovery

## Baseline and actual defect

This candidate starts from actual customer production `2cf186454c9a16c9f870affac4df63128716f8bc`, READY deployment `dpl_dZt7VDnE67NDMyGK17pwd63GAhwj`, https://xbar-horse-management-app.vercel.app/. Main still contains held #413; this branch must not be merged/deployed through incidental main to publish it. The blue X assets, manifest identity, worker and all other current live behavior are preserved.

On this base, a password sign-in rejected with Supabase's structured `email_not_confirmed` code only reports a generic inline failure. Resend/address-review controls exist only after signup. The exact baseline built-auth regression fails because no confirmation recovery heading/actions appear. That reproduction uses a synthetic GoTrue response through the real SDK, not a customer account or provider attack. The harness includes the modern API-version header/code and the legacy error_code wire format; the installed SDK normalizes both into error.code.

## Narrow change

- Password sign-in alone can return a typed confirmationRequired flag, selected only by the structured code. Raw message text cannot select recovery. Other auth-action contracts, the shared Supabase client and password-update locking remain unchanged.
- A coded rejection opens the in-app recovery panel immediately, identifies the exact address, clears the typed password, focuses the heading and keeps a previous-session redirect hold intact. An email/session mismatch never releases access to an older account.
- Normal no-session signup still takes one submit and shows the same Check your email guidance for both obfuscated new/existing responses. It does not assert delivery or account creation. There is one address input; Review email address reopens the appropriate existing form, prefills the address, preserves the plan and performs no auth request until the user submits. The accepted password is intentionally not retained in the inbox/recovery state.
- Resend remains the existing Supabase signup resend operation and safe callback builder. It is user initiated, has a 60-second local cooldown in addition to provider rate limits, and does not include a password. Successful/unknown-account responses use the same neutral requested-link message. Rate-limit/transport failures have fixed actionable public copy; provider diagnostics are not forwarded by this resend path. No delivery guarantee or different-inbox recommendation is made.
- Go to sign in remains available after email confirmation; existing callback/session arrival continues to open setup through the existing SDK path. Google remains a separate integration and is not enabled or changed here.

## Verification

All 182 configured sequential test commands passed, reporting 3,093 tests. The Windows command-length adapter executes every package-script command and does not skip assertions. TypeScript, ESLint (four existing refresh warnings), formatting and the Supabase-configured auth-smoke build passed.

21 built-browser cases passed: structured modern/legacy unconfirmed refusal, no recovery from message-only wording, password clearing, focus/address review, one-submit signup/plan preservation, manual neutral resend and cooldown, rate-limit/unknown-account privacy, identical signup guidance, existing-password sign-in, callback failure holds, and signup/confirmation return under three storage-failure modes. Phone 390px and desktop 1440px screenshots show the actual built recovery screen. These are local synthetic transport/auth regressions, not live customer/inbox or physical iPhone acceptance. Provider code parsing was corrected in the fixtures to match the installed SDK rather than changing the app to parse raw error text.

The old source guard prohibited even an imperative Check your email heading. It now retains the no-delivery-claim and anti-enumeration requirement, allows Confirm your email only for structured sign-in refusal, and is backed by the two-response identical-UI and one-submit browser cases. It is not relaxed to accept false delivery.

## Delivery and release boundaries

Exact-head CI/CodeQL/Analyze/Vercel and final review must pass. Stage only a clean immutable production-configured head with --skip-domain, preserving manual publishing and excluding held main. Do not promote until the applicable release gates are satisfied. The one-time advisor-count exception authorized for the prior icon release DOES NOT apply here; production Supabase health and advisor disposition must be rechecked/explicitly resolved for this candidate. No policy waiver is inferred from a request to make the feature live.

No API/backend, SMTP/provider settings, sender, Auth confirmation setting, account record, credentials, Google/OAuth, billing, DNS, SQL/migration, storage, offline worker, PWA identity or native binary is changed. No real mail was sent by these tests. The reported Yahoo 552 mailbox rejection is not evidence SMTP is missing and cannot be repaired by claiming delivery or editing a customer's account.

Remaining real acceptance requires a controlled authorized unconfirmed test identity and reachable inbox: ordinary sign-in must open recovery, one requested confirmation must actually arrive, its real link must complete confirmation and return to XBAR, and existing-user sign-in must remain valid. No customer account alteration, confirmation bypass or unapproved address is used to manufacture that result. A fresh browser and the installed Home Screen route must be labeled separately; physical iPhone verification is unavailable here. Do not uninstall or clear offline data.

Rollback anchor for an authorized release is the current icon deployment `dpl_dZt7VDnE67NDMyGK17pwd63GAhwj` / `2cf1864`. Use the normal authorized Vercel rollback route if needed; no database rollback belongs to this UI/auth-result patch.
