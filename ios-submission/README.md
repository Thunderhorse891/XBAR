# XBAR — iOS App Store submission runbook

This folder holds the submission assets that live in source control, plus the
exact steps to turn the web app into a signed iOS build. It is written against
what the code in this repo actually does — no placeholder claims.

XBAR ships as a [Capacitor](https://capacitorjs.com) app: the same Vite/React
bundle that runs on the web is wrapped in a native WKWebView shell. The web
foundation is already App-Store-shaped; the remaining work is the parts that
**require a Mac with Xcode** and an Apple Developer account, which cannot be
done on Linux/CI.

---

## Ready in this repo (no Mac needed)

- **App identity** — `capacitor.config.ts`: `appId: com.xbar.ranch`, `appName: XBAR`,
  dark launch background (`#05070A`) so a cold start doesn't flash white.
- **Mobile web build** — `npm run mobile:sync` / `mobile:copy` build the bundle
  with the hash router (no server to rewrite `/app/*` inside the WebView), skip
  the marketing-site post-build, and set `VITE_NATIVE_APP=true` so the store
  build's App Store gates apply from the first paint. Verified:
  `dist/index.html` is the SPA app shell.
- **Store-build compliance suite** — `npm run test:mobile-smoke` builds the
  native bundle and asserts the review-critical behavior on it. Run it before
  every submission; CI runs it on every push.
- **Required env for a release build** — set `VITE_PUBLIC_APP_URL` to the public
  site origin so in-app marketing/legal links resolve. Set Supabase values if
  the build should offer cloud sign-in.
- **Icons & PWA metadata** — `public/brand/` has `apple-touch-icon.png`,
  `icon-192.png`, `icon-512.png`, `icon-512-maskable.png`; `index.html` carries the
  viewport (`viewport-fit=cover`), `theme-color`, and `apple-mobile-web-app-*` meta;
  `site.webmanifest` is complete (standalone display, maskable icon).
- **Privacy manifest** — [`PrivacyInfo.xcprivacy`](./PrivacyInfo.xcprivacy),
  required by Apple. Add it to the App target.
- **Info.plist permission strings** —
  [`Info.plist.additions.plist`](./Info.plist.additions.plist). Merge into the
  generated `Info.plist`. These are **not optional**: the code uses the camera,
  photo library, and geolocation (see mapping below), and iOS crashes / App Review
  rejects a build that touches those without a purpose string.

### Capability → permission mapping (why each string is required)

| Capability             | Where in code                                                                   | iOS key                               |
| ---------------------- | ------------------------------------------------------------------------------- | ------------------------------------- |
| Camera capture         | `src/routes/AnimalProfile.tsx` `<input accept="image/*" capture="environment">` | `NSCameraUsageDescription`            |
| Choose existing photo  | same picker (library fallback)                                                  | `NSPhotoLibraryUsageDescription`      |
| Save export to library | packet/photo export (future-safe)                                               | `NSPhotoLibraryAddUsageDescription`   |
| Local weather          | `src/routes/Weather.tsx` `navigator.geolocation.getCurrentPosition`             | `NSLocationWhenInUseUsageDescription` |

---

## Steps that require a Mac + Xcode

1. **Generate the native project** (first time only):
   ```bash
   npm ci
   npm run mobile:add:ios      # npx cap add ios
   npm run mobile:sync         # build web + npx cap sync
   ```
2. **Add the submission assets** to `ios/App/App/`:
   - Drag `ios-submission/PrivacyInfo.xcprivacy` into the **App** target
     (Copy Bundle Resources).
   - Merge the keys from `ios-submission/Info.plist.additions.plist` into
     `ios/App/App/Info.plist`.
3. **App icon & launch screen** — generate the icon set from `public/brand/icon-512.png`
   (1024×1024 master required by Apple; upscale/redraw if needed — do **not** ship a
   transparent or rounded icon, Apple requires opaque square). Set the launch screen
   background to `#05070A` to match the config.
4. **Signing** — open `ios/App/App.xcworkspace` in Xcode, select your Team,
   set the bundle id to `com.xbar.ranch`, enable automatic signing.
5. **Version/build** — set marketing version and build number.
6. **Archive & upload** — Product ▸ Archive ▸ Distribute App ▸ App Store Connect.

## App Store Connect metadata (done in the browser, not code)

- App name, subtitle, category (Business / Productivity), age rating.
- **Privacy policy URL** (required) and support URL.
- **Privacy "Nutrition Label"** questionnaire — must match
  `PrivacyInfo.xcprivacy`: Email (linked, app functionality), Photos/Videos
  (linked, app functionality), Other user content (linked), Precise Location
  (not linked, app functionality, **not** used for tracking).
- Screenshots for required device sizes (6.7" and 6.5" iPhone, 12.9" iPad if you
  ship iPad). Capture from the running app.
- Sign-in demo account for App Review (the app is behind auth).

## App Review risk areas — status

Each of these is enforced in code and asserted against the **built store
bundle** by `npm run test:mobile-smoke`, which CI runs on every push. The store
bundle differs from the web bundle only by build flag, so the web suites cannot
see these behaviors — that suite builds the real artifact and checks what it
renders.

- **Purchases (3.1.1) — resolved.** The store build presents no purchase path.
  Every plan button renders disabled as "Managed outside the app", and
  `beginCheckout` returns before any navigation, so no code path reaches Stripe.
  The gate lives in `getCheckoutReadiness` (one tested decision, not scattered
  JSX) and is fed by `canPresentPurchaseFlow()` in `src/lib/nativePlatform.ts`.
  There is also no link out to Stripe or to `/pricing` anywhere in the build —
  Apple forbids the external link, not just the in-app charge.
- **Account deletion (5.1.1(v)) — resolved.** In-app deletion ships in Settings,
  backed by `api/account/delete.js`.
- **Sign in with Apple (4.8) — satisfied, needs configuration.** The app offers
  Apple sign-in alongside Google and Facebook, so the requirement is met in
  code. Configure the Apple provider in Supabase and an Apple Service ID before
  release _if you re-enable third-party sign-in on native_ — see the next point.
- **Third-party sign-in in a WebView (2.1) — disabled on native, deliberately.**
  `supabase.auth.signInWithOAuth` navigates the current WebView to the provider,
  which inside Capacitor means an embedded WKWebView returning to
  `capacitor://localhost`. Google refuses OAuth in embedded webviews and that
  scheme is not a valid provider redirect, so those buttons could not complete —
  a broken feature is a rejection. The store build therefore shows email/password
  and one-time-code sign-in only. To restore them, run the flow through
  `ASWebAuthenticationSession` (e.g. `@capacitor/browser`) with a registered deep
  link, and verify on a device.
- **Broken links (2.1) — resolved.** Marketing links (`/pricing`, `/privacy`,
  `/terms`) resolve through `publicSiteHref()` to the absolute public site in a
  store build, because the marketing pages are not in the native bundle and
  there is no server to route them. **Set `VITE_PUBLIC_APP_URL` for mobile
  builds** — without it those links fall back to relative paths that dead-end.
- **Export compliance — declared.** `ITSAppUsesNonExemptEncryption` is `false`
  in `Info.plist.additions.plist` (XBAR uses only standard TLS and Web Crypto).
  Without the key, every upload stalls on the export question and TestFlight
  will not distribute the build.
- **Purpose strings** — keep each usage description specific to the real use.

---

_This runbook is intentionally honest about the Mac-only boundary. Nothing here
claims the native binary is built or submitted — those steps happen on a Mac with
the Apple Developer account and cannot be run from this environment._
