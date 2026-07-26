# XBAR — App Store Connect listing metadata

Everything App Store Connect asks for that is text rather than code. Copy each
field straight across. Character limits are Apple's and are enforced by the
form; the counts below are for the copy as written here.

Nothing in this file is aspirational — every capability named is one the
shipped app actually has. If a feature is removed, edit this file in the same
change.

---

## App information

| Field              | Value                                                        |
| ------------------ | ------------------------------------------------------------ |
| App name (30 max)  | `XBAR: Horse & Ranch Records` (27)                           |
| Subtitle (30 max)  | `Papers, care, and sale packets` (30)                        |
| Bundle ID          | `com.xbar.ranch` (matches `capacitor.config.ts`)             |
| SKU                | `xbar-ranch-ios-001`                                         |
| Primary category   | Business                                                     |
| Secondary category | Productivity                                                 |
| Primary language   | English (U.S.)                                               |
| Age rating         | 4+ — no objectionable content, no user-generated public feed |
| Content rights     | Contains no third-party content                              |

### Age-rating questionnaire

Answer **None / No** to every question. XBAR has no violence, no simulated
gambling, no mature themes, no unrestricted web access (the WebView loads only
bundled app assets and the XBAR API), and no user-generated content visible to
other users outside a workspace the account owner controls.

---

## Description (4000 max)

```
XBAR keeps a horse operation's paperwork straight.

Registration papers, Coggins tests, vet records, bills of sale, transfer
forms — the documents that decide whether a horse can be sold, hauled, bred, or
shown usually live in a truck console, a barn office drawer, and three phones.
XBAR puts them in one place, attached to the horse they belong to.

WHAT IT DOES

Horse records
Build a real record for every horse: registration number and registry,
markings, microchip, foaling date, sire and dam, and a permanent XBAR ID that
stays with the animal. Photograph a horse straight from your phone.

Documents that read themselves
Photograph or upload papers and XBAR reads the registration number, registered
name, owner, breed, color, and foaling date off the page, then offers them to
the horse record. You review every extracted fact before it is applied —
nothing overwrites data you already trust.

Ownership you can prove
Track who owns each horse, what document proves it, and where a transfer
stands. XBAR shows the gaps: a horse with no bill of sale, a transfer with no
signed form, a Coggins that has expired.

Care and deadlines
Vaccinations, farrier visits, dentals, worming, vet follow-ups. See what is due
across the whole herd instead of remembering it one horse at a time.

Sale packets buyers trust
Assemble a watermarked buyer packet from the documents you have approved —
horse profile, ownership position, health records, photos. Share it as a link
and see what the buyer opened.

Ranch operations
Pastures, herd groups, feed and supply inventory, equipment, expenses,
breeding and foaling records, and local weather next to the day's work.

WORKS THE WAY A RANCH WORKS

Your workspace syncs across devices, so what the barn manager enters on a phone
is on the office computer. Invite your team with role-based access: a vet
assistant who only sees medical records, a sales lead who only sees buyer
follow-up.

SUBSCRIPTIONS

XBAR plans are purchased and managed through your XBAR account in a web
browser, not in this app. Sign in here with an existing account to use the plan
you already have.

Questions: support@xbar.app
```

## Promotional text (170 max, editable without a new build)

```
Photograph a registration paper and XBAR reads the numbers off it, attaches it
to the horse, and tells you what proof is still missing before a sale.
```

## Keywords (100 max, comma-separated, no spaces after commas)

```
horse,equine,ranch,barn,stable,livestock,coggins,registration,pedigree,vet,foaling,breeding,records
```

(99 characters. Do not repeat words already in the app name or subtitle —
Apple indexes those separately.)

## What's New (for version 1.0)

```
First release.
```

---

## URLs

| Field                         | Value                      |
| ----------------------------- | -------------------------- |
| Support URL (required)        | `https://xbar.app/support` |
| Marketing URL (optional)      | `https://xbar.app`         |
| Privacy policy URL (required) | `https://xbar.app/privacy` |

The privacy page is generated from `src/lib/legalDocuments.ts` by
`scripts/build-marketing.mjs` — the same source the in-app reader at
`/legal/privacy` renders, so the two cannot drift. Confirm the deployed origin
matches (`PUBLIC_SITE_ORIGIN`) before entering the URLs.

---

## App privacy ("nutrition label")

Must match `PrivacyInfo.xcprivacy` exactly — App Review compares them.

| Data type          | Collected | Linked to user | Used for tracking | Purpose           |
| ------------------ | --------- | -------------- | ----------------- | ----------------- |
| Email address      | Yes       | Yes            | No                | App functionality |
| Photos or videos   | Yes       | Yes            | No                | App functionality |
| Other user content | Yes       | Yes            | No                | App functionality |
| Precise location   | Yes       | **No**         | No                | App functionality |

Precise location is used at request time for the local weather lookup
(`src/routes/Weather.tsx`) and is not stored against the account — hence "not
linked". Everything else is workspace data the account owner enters.

Answer **No** to "Does this app use data for tracking?" and leave the tracking
domains list empty.

---

## Export compliance

XBAR uses only HTTPS/TLS for network calls and Apple's platform cryptography.
That is the standard exemption.

Add to `Info.plist` so the question is not asked on every upload:

```xml
<key>ITSAppUsesNonExemptEncryption</key>
<false/>
```

---

## App Review information

**Sign-in required:** yes. The app is behind authentication — App Review cannot
see anything without an account.

Create a real demo account before submitting and enter it here:

| Field    | Value                                                               |
| -------- | ------------------------------------------------------------------- |
| Username | `appreview@xbar.app` (create this; do not reuse a customer account) |
| Password | (set one, note it here in App Store Connect only)                   |

Seed the demo workspace with a handful of horses, at least one uploaded
document that has been through review, and one assembled sale packet. An empty
workspace makes the app look broken to a reviewer.

### Notes for the reviewer

```
XBAR is a records app for horse and ranch operations. The demo account above is
signed in to a workspace with sample horses, documents, and a sale packet.

Subscriptions: XBAR plans are sold only through the XBAR website, not in this
app. The Billing screen in the iOS build shows the plans read-only with no
purchase control and no link to an external purchase page, per Guideline 3.1.1.
The demo account is on a paid plan so all features are visible.

Account deletion: Settings ▸ Delete account. It permanently deletes the account
and every workspace the account solely owns (Guideline 5.1.1(v)). Please do not
run it on the demo account unless you intend to — we will need to recreate it.

Privacy policy and terms are readable inside the app without signing in, from
the links at the bottom of the sign-in screen.

Permissions:
- Camera / photo library — photographing a horse for its record (Horse ▸ profile
  photo) and attaching document images.
- Location (when in use) — the Weather screen looks up local conditions for the
  ranch. It is requested only when that screen is opened, and is not stored.

Contact: support@xbar.app
```

---

## Screenshots

Generated from the real running app by `npm run ios:screenshots` into
`ios-submission/screenshots/`, already at the exact pixel sizes App Store
Connect accepts:

| Device class | Pixels      | Required                         |
| ------------ | ----------- | -------------------------------- |
| 6.9" iPhone  | 1290 × 2796 | Yes                              |
| 6.5" iPhone  | 1242 × 2688 | Optional (older listing display) |
| 13" iPad Pro | 2048 × 2732 | Yes, if the app ships for iPad   |

The captures run with Capacitor's native global injected, so they show the iOS
build's actual UI — including the read-only Billing screen — rather than the
web build at a phone-sized viewport.

If you ship iPhone-only, set the destination in Xcode accordingly and skip the
iPad set; App Store Connect will not ask for it.

---

## Pre-submission checklist

Run `npm run ios:preflight` — it verifies the asset and compliance items in
this repo and lists the Mac-only steps it cannot check.
