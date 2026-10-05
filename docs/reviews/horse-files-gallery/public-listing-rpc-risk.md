# Unresolved release blocker: raw buyer-listing RPC payload

Source-only review of main `ff043870ad5095f46e28d01379ff937a820f19b6`. No live customer endpoint was probed, no database write was made, and no migration was applied. This is separate from the gallery/document UI corrections.

## Exact server path

The final resolver definition in the generated migration chain is `public.xbar_resolve_public_listing_legacy(text, text)` in [`20261001090000_workspace_keyed_storage_expand.sql`](https://github.com/Thunderhorse891/XBAR/blob/ff043870ad5095f46e28d01379ff937a820f19b6/supabase/migrations/20261001090000_workspace_keyed_storage_expand.sql#L171-L263). The public `xbar_resolve_public_listing` wrapper delegates to it after its release check. The legacy function itself also verifies that the selected listing is Live, release-confirmed, and either Public Link or accompanied by its correct nonempty private token.

The horse projection copies `payload::jsonb`, subtracting only:

- medicalNotes
- lastVetVisit
- ownership
- documentFacts
- alerts
- notes

It replaces those six keys with empty values and returns the rest as `horse`. Consequently the source permits other recorded keys through unchanged, including `costBasis`, `insuredValue`, `profileImage`, and the entire `gallery` with Pending, Draft or archived entries and their URL/storage-path metadata. Actual exposure depends on the fields in a released horse record and the deployed function version.

## Active caller and why UI filtering is insufficient

[`src/lib/publicShare.ts`](https://github.com/Thunderhorse891/XBAR/blob/ff043870ad5095f46e28d01379ff937a820f19b6/src/lib/publicShare.ts) calls `client.rpc('xbar_resolve_public_listing', { p_share_path, p_share_token })`, then passes the returned object through `parsePublicBuyerProfilePayload` and `sanitizePublicHorse`. [`BuyerProfile.tsx`](https://github.com/Thunderhorse891/XBAR/blob/ff043870ad5095f46e28d01379ff937a820f19b6/src/routes/BuyerProfile.tsx#L378) calls that loader for the buyer-facing page.

Client sanitization cannot remove data already returned over the network. The new gallery patch prevents an unapproved/removed primary from rendering in the buyer UI, but does not resolve this raw-response privacy boundary. Legacy public URLs or embedded data URLs are especially important to assess. Private cloud photo bytes still have a separate Approved-gallery check in `api/_lib/buyer-media.js`; this finding is not a claim that a storage path alone grants file access.

## Required release decision

Keep this server-side privacy question open until the deployed function definition is verified and an explicitly approved server projection/allowlist remedy is reviewed and applied, if needed. Do not report buyer-data privacy as fixed based on client filtering. No server workaround is included in this UI patch.
