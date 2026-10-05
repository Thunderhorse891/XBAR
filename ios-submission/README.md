# XBAR iOS build and submission

The native project is checked in at `ios/App/App.xcodeproj`. Use Node 24, matching `.nvmrc` and CI. It uses Capacitor
8.5.1 and Swift Package Manager, targets iOS 15+, and supports iPhone and iPad.
The existing paid-web companion behavior is preserved: the native app has no
checkout or upgrade flow. Apple must still review the submitted product.

## Build checks

```sh
npm ci
npm run mobile:sync:ios
```

This builds the hash-routed SPA, synchronizes Capacitor and verifies the packaged
source resources. `CAP_SERVER_URL` is refused by the store build. The HTTPS
backend defaults to the app origin; set `VITE_API_BASE_URL` to an HTTPS origin
when the backend is hosted separately. Welcome, account deletion and packet
verification use that backend too. The backend permits the exact bundled iOS origin `capacitor://localhost`;
endpoint authentication, workspace permissions and rate limits still apply.
Wildcards, `Origin: null` and lookalike native origins are not permitted.
Welcome requests answer preflight before authentication or email work. A configured URL or successful
unsigned build does not establish live native connectivity.

The `iOS native` workflow uses a standard macOS runner in this public repository.
It requires Xcode 26 and the iOS 26 SDK, compiles an unsigned device Release
build, checks resources in the actual `.app`, and runs an XCTest against the
real WKWebView in the iOS Simulator. That test renders the sign-in screen,
enters a synthetic email and password, and verifies the native sign-in controls. It does not
submit a request or create a customer account. Browser smoke tests remain
separate and do not substitute for this native test.

CI uses `native-ci.invalid` and a synthetic public auth key. **Never distribute
that build.** No signing credential, Apple account, upload or deployment is used.
A green run establishes compilation and the tested startup behavior only.

## Release inputs and device acceptance

1. Close the production release gates, and verify the merged native
   routing/CORS behavior on a real device:
   verified backup/hosted restore, authorized migrations, rate limiting,
   monitoring, live auth-mail and payment/workflow acceptance. The native app
   depends on that backend even when the website launch comes later.
2. Supply the real public Supabase URL/anon key and HTTPS backend configuration
   to the release build. Never include service-role, Stripe secret, email-provider
   or signing keys in `VITE_*` variables or bundled files.
3. In an owner-authorized Apple Developer team, confirm the registered bundle ID
   `com.xbar.ranch`, signing profile and App Store Connect app. Set version/build,
   open `ios/App/App.xcodeproj`, select the App scheme, and build for a physical
   device with Xcode 26 or later and the iOS 26 SDK or later. Enrollment, signing and submission are owner steps;
   no fee or upload is authorized by the CI workflow.
4. Test password sign-in, sign-up confirmation, in-app email-code sign-in,
   password recovery, workspace sync/reload, camera/photo/document import,
   real document-to-horse review, Files/share-sheet export and safe account
   deletion using disposable authorized accounts. Exercise offline and rejected
   server responses on a real device. Do not delete an owner's real account.
5. Validate the icon in an archive: the 1024px export is generated from the
   owner-selected original horse artwork using the same proportional resize and
   silver framing as the existing public icons. The supplied master is unchanged.
   Confirm opacity/export validation and review the actual launch screen and store
   screenshots. `python scripts/brand/original-build.py --verify` checks the exports.
6. Only after those checks and explicit submission approval: archive, validate,
   distribute to TestFlight, complete device acceptance and submit to App Review.

## Auth configuration

The Supabase Magic Link email template must include both `{{ .ConfirmationURL }}`
for web users and `{{ .Token }}` for the native email-code flow. The native build
hides OAuth buttons that cannot return a session to its bundled WebView. Verify
actual email delivery, template content and the production redirect allowlist;
a synthetic test or an existing confirmed account does not establish delivery.

## Privacy and submission materials

`ios/App/App/Info.plist` and `ios/App/App/PrivacyInfo.xcprivacy` are the packaged
sources of truth. Camera, photo-library selection and weather location have
purpose strings. There is no speculative photo-library-write permission:
exports use Files/share sheets. The Filesystem plugin's documented timestamp
reason C617.1 is included; generic unused required-reason categories from the
old draft are not included. Re-audit the manifest when SDKs or collection change.
The imported collection inventory is incomplete and is an explicit distribution
blocker. Production monitoring is enabled by default and can store user-linked
page views and error/stack diagnostics (`runtimeEvents.ts`, `App.tsx`, and
`globalErrorHandlers.ts`). Reconcile user identifiers, product interactions,
applicable diagnostic categories, other collected profile/business data and
third-party weather processing across the manifest, privacy policy and App Store
Connect answers before signing a distribution build. The native URL repair
preserves the prior telemetry API-fallback setting; it does not silently enable
that fallback. This draft does not certify the complete collection inventory.

Provide a reachable privacy-policy/support URL, final app description and age
rating, screenshots in Apple's currently required device sizes, and a working
reviewer account with backend access. Do not label CI screenshots as customer
workflow acceptance. No App Store listing, signed archive or review approval
is established by this repository alone.

References: [Apple SDK requirements](https://developer.apple.com/news/?id=ueeok6yw),
[Capacitor iOS](https://capacitorjs.com/docs/ios),
[Filesystem privacy manifest](https://capacitorjs.com/docs/apis/filesystem),
[App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).

## Swift dependency lock before release

Capacitor itself is exact-pinned, but the Filesystem plugin uses a version range
for its native filesystem dependency. After the macOS build resolves the actual
Swift package graph, capture and review Package.resolved for reproducible release
builds. This is not established by the Linux resource sync.
