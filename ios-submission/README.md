# XBAR — iOS App Store submission runbook

This folder holds the submission assets that live in source control, plus the
exact steps to turn the web app into a signed iOS build. It is written against
what the code in this repo actually does — no placeholder claims.

XBAR ships as a [Capacitor](https://capacitorjs.com) app: the same Vite/React
bundle that runs on the web is wrapped in a native WKWebView shell. The web
foundation and native shell can be checked without Apple credentials. Real iOS
compilation and Simulator testing require macOS/Xcode. Signing, upload and
distribution are separate. This branch is for unsigned packaging and synthetic
smoke testing only; **do not distribute its CI build**.

---

## Ready in this repository

- **App identity:** `capacitor.config.ts` uses `com.xbar.ranch` and XBAR.
  The native app icon and splash use the checked-in brand artwork unchanged.
- **Mobile web build:** `npm run mobile:sync:ios` builds the bundled hash-router
  SPA, synchronizes the tracked project, and checks its packaged configuration.
- **Canonical native metadata:** the [app privacy manifest](../ios/App/App/PrivacyInfo.xcprivacy)
  is an App target resource, and the [app Info.plist](../ios/App/App/Info.plist)
  holds the integration's permission strings. Do not maintain separate copies.
- **Privacy is not signed off:** the imported manifest is a packaging baseline,
  not a complete disclosure. Before any distribution, reconcile data collection,
  telemetry, SDK privacy reports, actual cloud/email/weather provider practices
  and retention, release policy, and App Store Connect answers. Review the
  location wording and linkage classification against the actual weather
  provider. No release should be cut using these unverified declarations.

### Capability → permission mapping (why each string is required)

| Capability            | Where in code                                                                   | iOS key                               |
| --------------------- | ------------------------------------------------------------------------------- | ------------------------------------- |
| Camera capture        | `src/routes/AnimalProfile.tsx` `<input accept="image/*" capture="environment">` | `NSCameraUsageDescription`            |
| Choose existing photo | same picker (library fallback)                                                  | `NSPhotoLibraryUsageDescription`      |
| Local weather         | `src/routes/Weather.tsx` `navigator.geolocation.getCurrentPosition`             | `NSLocationWhenInUseUsageDescription` |

---

## Native backend routing

The bundled WebView serves local files from `capacitor://localhost`; it cannot
serve `/api` requests. `scripts/build-mobile.mjs` now supplies an HTTPS backend
origin to the mobile bundle. It uses `VITE_API_BASE_URL` when set, otherwise the
configured app origin (and the existing public-origin fallback). Use the real
API host when the marketing site and backend have different domains. Explicit
API URLs must contain no credentials, path, query or fragment. Store builds
refuse `CAP_SERVER_URL`; use the development workflow for live reload.

Account deletion, welcome email and packet verification use the same backend
URL helper as the other API clients. Web builds still use same-origin requests
when no API override is configured. Existing telemetry API-fallback preferences
are preserved; supplying the native API origin does not enable that fallback.

The API permits the exact bundled iOS origin `capacitor://localhost` and the
existing configured HTTP(S) web origins. Welcome requests now answer preflight
before authentication or email work. This is transport permission only: bearer
tokens, endpoint authentication, workspace permissions and rate limits still
apply. Wildcards, `Origin: null` and lookalike native origins are not permitted;
credentialed cookie sharing is not enabled. Custom native schemes require a
separate reviewed configuration change.

**Synthetic transport tests are not physical-device acceptance.** Validate
real sign-in, server requests and safe account deletion on an authorized test
account in the actual WKWebView before distribution. The shell extraction does not change CORS or backend policy.

## Steps that require a Mac + Xcode

1. **Build and synchronize** the tracked project with Node from `.nvmrc`:
   ```bash
   npm ci
   npm run mobile:sync:ios
   ```
2. **Unsigned device and Simulator gates:** see the [native workflow](../.github/workflows/ios.yml).
   On macOS it builds Release without distribution signing and tests the
   bundled WKWebView with synthetic credentials without submitting them.
   An old workflow result does not establish an exact-head pass.
3. **Real-device behavior:** verify login and recovery, navigation, workspace
   persistence, photos/documents, save/share flows, and safe account deletion
   with an authorized disposable account. Do not submit a synthetic build.
4. **Signing:** only for an authorized release, open
   `ios/App/App.xcodeproj`, select the responsible Apple team, verify
   `com.xbar.ranch`, and set version/build number. Archive/upload only after
   privacy, signing, device, and release approvals.

## App Store Connect metadata (done in the browser, not code)

- App name, subtitle, category (Business / Productivity), age rating.
- **Privacy policy URL** (required) and support URL. The app includes the same
  canonical privacy destination on Sign In, Workspace Setup, and Settings.
  Open each from the signed native build with the intended production origin;
  confirm the destination loads without authentication and matches the URL
  entered in App Store Connect. This addresses link discoverability
  ([Guideline 5.1.1(i)](https://developer.apple.com/app-store/review/guidelines/#privacy)),
  not the accuracy of the disclosures or packaging.
- **Privacy "Nutrition Label"** questionnaire: reconcile it with the packaged
  manifest after a complete disclosure and provider review. Do not reuse the
  baseline declarations as approved privacy answers.
- Capture screenshots from the running app and use the current
  [Apple screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
  for both iPhone and iPad, which this project supports.
- Sign-in demo account for App Review (the app is behind auth).

## Required Supabase configuration (before the first store build)

**The Magic Link email template must contain BOTH `{{ .ConfirmationURL }}` and
`{{ .Token }}`.** Add the token; do not remove the link.

Supabase chooses what to send from the template, not from the API call:
`{{ .ConfirmationURL }}` renders a clickable link, `{{ .Token }}` renders a
six-digit code. The default template has only the link.

Both are needed because **this template is global** — every `signInWithOtp`
email in the deployment uses it, not only the native request. Settings exposes
a "Send magic link" button (`Settings.tsx`, `handleSendMagicLink`) and that
screen has no code input, so a template carrying only the token would hand web
users a code the flow that sent it cannot consume. A template carrying both
serves each: the app's code input accepts the token, and the Settings link keeps
working.

The store build hides Google, Apple and Facebook sign-in, because
`signInWithOAuth` navigates the WebView to the provider and returns to
`capacitor://localhost` — a redirect Google refuses and Supabase will not
accept. Those buttons are the ONLY credential an account created through them
has, so the signed-out screen offers an emailed code instead: a code is typed
into the app and exchanged there, which is the only emailed route that puts a
session in the app rather than in a browser.

If the template still sends a link, that customer receives something the code
input cannot accept, and is locked out of iOS entirely — with a form in front of
them that looks like it should work. This cannot be set from code, so it is a
submission prerequisite rather than a deployment nicety.

Set it in Supabase → Authentication → Email Templates → Magic Link.

---

## Known App Review risk areas for this app

- **Account deletion** — on the signed-in Workspace Setup screen, expand
  **Delete account** without creating a ranch, or use **Settings → Delete account**
  after setup. Verify both routes on the signed device build with expendable,
  authorized QA accounts, matching-email confirmation and protected shared ranch
  states. Check backend disposition receipts and scope of on-device cleanup.
  Synthetic tests do not verify device behavior or App Review acceptance
  ([Guideline 5.1.1(v)](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion)).
- **Purchases** — Stripe is web-only in this build. The native Billing page is
  read-only, including direct and legacy routes; the store app does not offer a
  purchase, trial, or payment-management link. This is conservative app behavior,
  not App Review clearance. Review [Apple's payment guidelines](https://developer.apple.com/app-store/review/guidelines/#payments)
  for the intended storefront and access model before submission. Guideline
  3.1.1(a) treats U.S. storefront links differently and limits other external
  purchase links by storefront and entitlement. Guideline 3.1.3(b) generally
  requires items accessed across platforms to also be offered via in-app
  purchase. Do not assume that accepting existing web subscriptions without
  payment buttons fits an exception; no StoreKit or storefront-specific purchase
  path is implemented here.
- **Purpose strings** — keep each usage description specific to the real use.

---

_This runbook is intentionally honest about the Mac-only boundary. Nothing here
claims the native binary is built or submitted — those steps happen on a Mac with
the Apple Developer account and cannot be run from this environment._
