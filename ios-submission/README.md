# XBAR — iOS App Store submission runbook

This folder holds the submission assets that live in source control, plus the
exact steps to turn the web app into a signed iOS build. It is written against
what the code in this repo actually does — no placeholder claims.

XBAR ships as a [Capacitor](https://capacitorjs.com) app: the same Vite/React
bundle that runs on the web is wrapped in a native WKWebView shell. Everything
that does not require a Mac is done and verifiable from this repo; the
remaining work is signing and archiving, which needs Xcode and an Apple
Developer account.

Start here:

```bash
npm run ios:preflight
```

It checks the assets, the App Review compliance gates in the shipped code, and
the metadata, then lists the Mac-only steps it cannot verify. Exit code 1 means
something would get the build rejected.

---

## In this folder

| File                                                         | What it is                                                           |
| ------------------------------------------------------------ | -------------------------------------------------------------------- |
| [`APP-STORE-METADATA.md`](./APP-STORE-METADATA.md)           | Every text field App Store Connect asks for, ready to paste          |
| [`AppIcon.appiconset/`](./AppIcon.appiconset)                | 1024×1024 marketing icon, **no alpha channel**, plus `Contents.json` |
| [`PrivacyInfo.xcprivacy`](./PrivacyInfo.xcprivacy)           | Apple privacy manifest — add to the App target                       |
| [`Info.plist.additions.plist`](./Info.plist.additions.plist) | Permission purpose strings — merge into `Info.plist`                 |
| `screenshots/`                                               | Real captures at the exact pixel sizes Apple accepts                 |

Regenerate the two build products with:

```bash
npm run ios:assets                              # the alpha-free 1024 icon
npm run build:local && npm run ios:screenshots  # the device screenshots
```

---

## Ready in this repo (no Mac needed)

**App identity** — `capacitor.config.ts`: `appId: com.xbar.ranch`, `appName: XBAR`,
dark launch background (`#05070A`) so a cold start doesn't flash white.

**Mobile web build** — `npm run mobile:sync` / `mobile:copy` build the bundle
with the hash router (no server to rewrite `/app/*` inside the WebView) and skip
the marketing-site post-build.

**App icon** — `public/brand/xbar-app-icon.png` is a 1024×1024 RGBA file, and
App Store Connect rejects an icon PNG carrying an alpha channel even when it is
fully opaque. `npm run ios:assets` re-encodes it without one
(`scripts/build-ios-assets.mjs`); a unit test asserts the output stays alpha-free.

**Screenshots** — `npm run ios:screenshots` drives the real built app through a
real workflow at 430×932@3x, 414×896@3x and 1024×1366@2x, producing PNGs that
are exactly 1290×2796, 1242×2688 and 2048×2732. The captures inject Capacitor's
native global first, so they show the iOS build's UI — not the web build at a
narrow viewport.

**Privacy manifest and purpose strings** — see the table below. These are
**not optional**: the code uses the camera, photo library, and geolocation, and
iOS crashes the WebView (and App Review rejects the build) when a capability is
touched without its purpose string.

### Capability → permission mapping

| Capability             | Where in code                                                                   | iOS key                               |
| ---------------------- | ------------------------------------------------------------------------------- | ------------------------------------- |
| Camera capture         | `src/routes/AnimalProfile.tsx` `<input accept="image/*" capture="environment">` | `NSCameraUsageDescription`            |
| Choose existing photo  | same picker (library fallback)                                                  | `NSPhotoLibraryUsageDescription`      |
| Save export to library | packet/photo export                                                             | `NSPhotoLibraryAddUsageDescription`   |
| Local weather          | `src/routes/Weather.tsx` `navigator.geolocation.getCurrentPosition`             | `NSLocationWhenInUseUsageDescription` |

`npm run ios:preflight` re-checks this mapping against the source both ways: a
capability used without a string is a failure, and a string with no matching
code path is a warning (Apple rejects declared capabilities an app never uses).

---

## How the native build differs from the web build

The same bundle runs in both. `src/lib/nativeRuntime.ts` detects the Capacitor
shell, and four things change:

1. **No purchases (Guideline 3.1.1).** XBAR sells subscriptions through Stripe
   on the web. An iOS app may not sell digital subscriptions through anything
   but In-App Purchase, and may not route the user to an outside purchase. In
   the iOS build the Billing screen shows plans read-only — no purchase button,
   no card panel, no link out — and `beginCheckout` refuses to run at all. The
   sign-in screen also drops its `/pricing` link, which is a marketing-site path
   that is not in the native bundle anyway.

   **This is the decision to revisit if you want to sell inside the app.** Doing
   so means adding StoreKit In-App Purchase and giving Apple its commission; it
   is a product and pricing decision, not a code cleanup.

2. **Safe-area insets.** `src/styles/nativeShell.css` (scoped to
   `html.is-native-app`) keeps the top bar clear of the Dynamic Island and lifts
   the bottom tab bar above the home indicator. The web and PWA layouts are
   untouched — there the OS draws its own chrome.

3. **Exports use the share sheet.** `<a download>` does nothing in a WKWebView:
   no download manager, and the `download` attribute is ignored. Every export
   goes through `src/lib/fileDelivery.ts`, which writes the file and opens the
   iOS share sheet ("Save to Files", Mail, AirDrop) instead. Buttons say "Share"
   rather than "Download" so the label matches what happens.

4. **No service worker.** The binary already ships every asset; a service worker
   layered under Capacitor's local server is a known cause of stale assets after
   an app update.

Legal documents are readable in the app at `/legal`, outside authentication, so
App Review can reach the privacy policy on a fresh install without an account.

---

## Steps that require a Mac + Xcode

1. **Generate the native project** (first time only):

   ```bash
   npm ci
   npm run mobile:add:ios      # npx cap add ios
   npm run mobile:sync         # build web + npx cap sync
   ```

   `cap sync` also installs the CocoaPods for `@capacitor/filesystem` and
   `@capacitor/share`, which the export/share path depends on.

2. **Add the submission assets** to `ios/App/App/`:
   - Copy `ios-submission/AppIcon.appiconset` over the generated
     `Assets.xcassets/AppIcon.appiconset`.
   - Drag `ios-submission/PrivacyInfo.xcprivacy` into the **App** target
     (Copy Bundle Resources).
   - Merge the keys from `ios-submission/Info.plist.additions.plist` into
     `ios/App/App/Info.plist`, and add `ITSAppUsesNonExemptEncryption = false`
     (see APP-STORE-METADATA.md § Export compliance).

3. **Launch screen** — set the storyboard background to `#05070A` to match
   `capacitor.config.ts`, so a cold start does not flash a different colour.

4. **Signing** — open `ios/App/App.xcworkspace`, select your Team, confirm the
   bundle id is `com.xbar.ranch`, enable automatic signing.

5. **Version/build** — set the marketing version and build number.

6. **Test on a real device** before archiving. Specifically check: the top bar
   clears the Dynamic Island, the tab bar clears the home indicator, the camera
   prompt appears with the right wording on a horse profile, the Weather screen
   asks for location only when opened, an export opens the share sheet, and the
   Billing screen shows no way to buy anything.

7. **Archive & upload** — Product ▸ Archive ▸ Distribute App ▸ App Store Connect.

8. **Fill in the listing** from
   [`APP-STORE-METADATA.md`](./APP-STORE-METADATA.md), upload the screenshots,
   and create the App Review demo account described there. The app is behind
   auth — a submission without working credentials is rejected without review.

---

_Nothing in this folder claims the native binary is built or submitted. Those
steps happen on a Mac with the Apple Developer account and cannot be run from
CI or from a Linux checkout._
