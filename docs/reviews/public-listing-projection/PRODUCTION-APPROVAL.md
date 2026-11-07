# Public listing SQL: scoped production approval

The prepared operation replaces only `public.xbar_resolve_public_listing_legacy(p_share_path text, p_share_token text default null) returns jsonb`. The public wrapper `public.xbar_resolve_public_listing(text,text)` is unchanged. No table, row, owner, grant, RLS policy, role, credential or storage permission changes. The selected listing's existing Live/release/token checks remain unchanged.

Formal migration: `supabase/migrations/20261005122848_public_listing_projection.sql`, generated using the official npm Supabase CLI2.81.3 `migration new public_listing_projection`, then populated with the reviewed function body. This file has not been applied to production. The CI workflow uses only its isolated local PostgreSQL service; repository publication, merge and web deployment do not apply database migrations.

## Response contract

- Horse identity retained: canonical id, name, barnName, breed, registry, AQHA/registration number, registered, age, foaledOn, sex, color and markings. Bloodline retains scalar sire/dam/family. Sale retains listing state, asking price and social readiness; internal buyer-confidence/inquiry/watchlist counts are zero. Readiness retains score/packetStatus; blockers are empty.
- Horse fields removed: cost basis, insured value, owner/owner entity, microchip, location, assignments, tags, internal segment/status/summary, ownership, medical/breeding/activity timelines, breeding economics, document IDs/facts, alerts/notes and unknown future keys.
- Gallery retains only Approved Hero/Conformation/Sale Still entries with scalar id/label/kind/url/storagePath/status and boolean primary selection. Pending/Draft/Archived items, document scans, arbitrary nested fields and unapproved standalone profile URLs are excluded. Primary ordering preserves explicit flags, valid legacy URL selection and stable original order.
- Documents retain the existing Ready-document public metadata: id/title/type/horseId/uploadedAt/source/state/confidence/duplicateRisk/summary/fileName/mimeType/fileSizeBytes. Extracted preview/uploader are blank. Entities retain only the existing scalar certificate fields: horseName, registrationNumber, registry, sex, color, breed, foaledOn, sire/sireRegistration, dam/damRegistration, ownerName, examDate, veterinarian and transferStatus. Original download URLs, storage paths, vault keys, unknown fields and arbitrary nested objects are excluded.
- Ownership retains only id/horseId/transferStatus/confidence, including typed legacy transfer status fallback. Owner identity, deadlines, pending document lists and audit trail are omitted.
- Listing retains canonical id/horseId/workspaceId/sharePath/accessMode/state/channels/updatedAt and the existing private share token only for Private Token mode. Release confirmer identity, arbitrary notes and unknown payload keys are omitted. Canonical workspace and approved photo paths remain available to the existing buyer-media authorization endpoint.

## Effect on buyers

Existing authorized public/token links should retain buyer identity, sale/certificate summaries and approved photos. Raw HTTP responses lose internal fields even if a caller bypasses the UI. Invalid, withdrawn, unapproved or retired links continue to return no listing. No existing original horse/document/media bytes are modified.

## Rollback without restoring exposure

The migration is transactional: a failure before commit leaves the previous function unchanged. After a successful change, do not restore the historical raw-payload implementation. If an unexpected compatibility failure requires immediate containment, the separately reviewed `supabase/checks/public-listing-projection.fail-closed.sql` replaces this same function with `return null`. That temporarily disables all buyer listing resolution, listing media authorization and inquiry submission. Use it only with the owner's approval, then forward-fix or reapply the corrected allowlist. It changes no data or permissions. The isolated fixture exercises both the closed state and subsequent recovery.

## Verification without customer records

Use the exact repository migration in disposable PostgreSQL17.6 with synthetic users/workspaces/horses/documents/listings. The fixture proves the original anonymous disclosure, checks corrected raw JSON plus valid public/private controls, exercises malformed payloads and primary selection, repeats application, and rolls back every synthetic business record. After approved production application, verify function signature/security/search_path/ACL and exact function-definition digest against the reviewed migration; use only a clearly nonexistent synthetic share path to check refusal through the public wrapper. Do not retrieve a real listing or insert synthetic production records.

Earlier exact-head proof: run37309203162/job111760181343 passed before/after/idempotence with the corrected ordering. The formal migration, legacy ownership control and emergency fallback require their own final exact-head runtime and CI proof before an approval request. No production SQL is authorized by this document.
