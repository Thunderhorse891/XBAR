# Ranch social profiles and sale-document handoff

Scope requested by the owner: clickable ranch social profiles and an option to hand a generated selling document to a social app. Starts from main `076b03c8e1deae56011d962d8a904c4b8ef38d80` (tree `20e063cb43acb3be71538a22cb137a8bf320f729`). No database migration, OAuth connection, automatic posting, native-project change, or production release is part of this work.

## Ranch profiles

Sales displays safe public Instagram, Facebook, X, YouTube and TikTok links. Manage social links opens the ranch profile in Settings. The existing admin-only draft, context-invalidation, durable-save receipt and cloud-sync behavior applies. Saving on this device does not claim that cloud synchronization finished. Links are stored in the existing workspace profile payload and survive backup restoration. Blank fields remove links; unrelated profile updates preserve them. Only supported HTTPS profile hosts/paths are accepted. Tracking queries and fragments are removed, except Facebook's required numeric profile ID.

## Generated documents

Sale Packets offers Share document for an existing generated packet. It prepares the actual saved file, warns about the full packet and its private attachments, and requires review before handing it to a selected app. This does not mark a packet published or upload it automatically. Native share and browser file-sharing capabilities differ; unsupported devices have an explicit download/manual-upload path. PDF and HTML are not supported by every social platform. There is no fabricated image conversion. A successful share-sheet handoff cannot verify that the recipient app posted anything.

## myAQHA

The Documents upload stage links to the official [myAQHA portal](https://www.myaqha.com/). Customers obtain available files there, then use XBAR's existing upload and horse-match review. This is not an AQHA connection, automatic sync, registry verification, or guarantee that every certificate is downloadable. Original documents can contain private owner data. Unregistered horses can still be added.

## Platform policy

Checked October 5, 2026. [Meta's Oversight Board decision](https://www.oversightboard.com/decision/bun-63gbjx9k/) distinguishes restricted peer-to-peer animal-sale posts from legitimate-business exceptions, and states that Commerce Policies prohibit animal sales on Marketplace. [Meta's published sustainability report](https://sustainability.fb.com/wp-content/uploads/2021/06/2020_FB_Sustainability-Report-1.pdf) also describes the live-animal/livestock commerce prohibition. Ordinary ranch profile links are not a claim that any particular animal-sale post is permitted. No Marketplace posting target is added.

## Validation scope

Synthetic unit and actual-store tests cover URL validation, restoration, explicit removal, unrelated-update preservation, and role refusal. The initial actual-store persistence and invalid-update regressions failed on the unchanged main implementation. Browser cases cover the small-screen workflow and reuse the existing interrupted profile-save tests for storage failure/retry and account/workspace/role round trips. Native coverage is limited to simulated bridge failures, pure helpers and source assertions; the plugin handoff itself requires a device. Physical-device delivery and real social uploads are not claimed. CI must run the configured browser suite on the final head. Keep this PR in draft and hold main/production pending the owner's specific approval.
