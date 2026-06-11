# XBAR Backend & Data Pipeline (OCR → Horse Profile → Sale Packet)

This document covers the production data infrastructure added in the
`20260609_ocr_documents_sale_packets.sql` migration and the `api/` serverless
endpoints that implement the OCR ingestion, document entitlement, document
generation, sale packet, reminder, and import/export flows.

## Architecture at a glance

```
Client (Vite/React, tesseract.js + pdf.js local pre-OCR)
   │  Bearer <supabase access token>
   ▼
Vercel serverless functions (api/…)          Supabase (Postgres + Storage + Auth)
   ├─ documents/bulk-upload-with-ocr ──────► documents, horses, reminders,
   │     OCR (client text | AWS Textract)    intake_batches, document_processing_jobs
   ├─ documents/generate-from-template ────► documents + horse-documents bucket
   ├─ sale-packets (pdf-lib merge) ────────► sale_packets + sale-packets bucket
   ├─ reminders/run (Vercel cron, daily) ──► notifications + email (Resend/SendGrid)
   ├─ horses/import · horses/export
   └─ stripe/checkout · stripe/webhook ────► workspace_subscription_profiles
```

Design decisions:

- **Multi-tenancy** reuses the existing `workspaces` model (a workspace is a
  barn/stable). Row Level Security is enforced with the existing
  `xbar_has_workspace_access` / `xbar_can_manage_workspace` security-definer
  functions; vets get per-horse read grants via the new `horse_vet_access`
  table, which extends the `horses` and `documents` SELECT policies.
- **All API writes use the service-role client** after verifying the caller's
  Supabase access token and workspace membership (`requireWorkspaceAccess`),
  the same pattern as `api/invite.js` and `api/stripe/*`.
- **Documents are private.** Originals live in the `horse-documents` bucket;
  assembled packets live in the new `sale-packets` bucket which has *no*
  client policies — files are only reachable through 1-hour signed URLs
  minted by the API.
- **OCR is provider-pluggable.** The default path uses the text the client
  already extracts locally with tesseract.js / pdf.js (`providedText`).
  Setting `OCR_PROVIDER=textract` plus AWS credentials switches to AWS
  Textract `DetectDocumentText`, called over REST with SigV4 (no AWS SDK in
  the bundle). The async/queued Textract path (multi-page PDFs, custom
  adapters trained on AHA/USEF/Jockey Club forms) plugs into
  `api/_lib/ocr.js` without touching the pipeline.

## Database schema

Run order: `supabase/production-schema.sql` → everything in
`supabase/migrations/` sorted by filename. `npm run supabase:prepare` emits a
single executable file at `supabase/production-schema.generated.sql`.

### Extended tables

`horses` (new columns)

| Column | Type | Notes |
|---|---|---|
| `breed`, `color`, `birthdate`, `gender`, `microchip`, `registry` | text | identity fields filled by OCR or CSV import |
| `created_from_document_id` | text | document that auto-created this profile |
| `ocr_confidence` | double | overall confidence of the creating extraction |

`documents` (new columns)

| Column | Type | Notes |
|---|---|---|
| `original_filename`, `storage_path`, `mime_type` | text | original upload, stored for audit alongside OCR text |
| `ocr_text` | text | full extracted text (capped at 20k chars) |
| `ocr_confidence_map` | jsonb | per-field confidence (0–1) |
| `extracted_data` | jsonb | parsed fields per document type |
| `needs_review` | boolean | true when overall confidence < 0.9, multiple horses detected, or OCR failed |
| `review_notes` | text | human-readable reason for the review flag |
| `intake_batch_id` | text | links back to `intake_batches` |
| `uploaded_by_user_id` | uuid | auth user who uploaded |

### New tables

| Table | Purpose | RLS |
|---|---|---|
| `document_templates` | tier-gated catalog (15 templates); `template_content` is an optional per-deployment HTML override — when empty the API renders the built-in definition from `api/_lib/document-templates.js` | read: all authenticated; write: service role |
| `sale_packets` | assembled packet per horse: `packet_pdf_path`, `watermark_text`, `shared_with_email`, `document_ids` | read: workspace member; write: owner/Admin |
| `reminders` | `type` (coggins, vaccination, deworming, farrier, health_cert), `due_date` (date), `notification_sent` | read: member; write: owner/Admin |
| `notifications` | in-app inbox written by the reminder job | read: own or workspace; update (mark read): own |
| `horse_vet_access` | per-horse vet grants; also grants the vet SELECT on that horse + its documents | manage: owner/Admin |
| `audit_logs` | who viewed/edited/generated what (`action`, `entity_type`, `entity_id`, `metadata`) | read: owner/Admin; insert: member (self) or service role |

## API reference

All endpoints require `Authorization: Bearer <supabase access token>` except
`reminders/run` (cron secret). Errors are `{ ok: false, message }` with
appropriate status codes (401/403/404/405/500); tier failures return 403 with
`code: "tier_required"`, `requiredPlan`, and `currentPlan`.

### POST `/api/documents/bulk-upload-with-ocr`

Bulk PDF/image/ZIP ingestion → OCR → extraction → horse matching.

```jsonc
{
  "workspaceId": "…",
  "mode": "auto",            // "auto" | "preview" | "commit"
  "batchLabel": "March intake",
  "files": [{
    "fileName": "spirit-registration.pdf",
    "mimeType": "application/pdf",
    "contentBase64": "…",          // or:
    "storagePath": "uid/ws/…",     // file already in the horse-documents bucket
    "providedText": "…",           // client-side OCR text (preferred path)
    "providedConfidence": 0.97
  }]
}
```

Behavior:

1. ZIP archives are expanded server-side (stored + deflate entries).
2. Each file is stored in `horse-documents`, OCR'd, classified
   (registration / coggins / health_cert / transfer / bill_of_sale), and
   parsed into `extracted_data` + `ocr_confidence_map`.
3. Extractions are grouped into **horse candidates** — documents sharing a
   registration number, microchip, or name merge into one profile (Coggins +
   registration → single horse).
4. Candidates are matched against existing horses by registration number,
   then microchip, then unique exact name.
5. In `auto` mode: matched candidates attach to the existing horse;
   unmatched candidates with confidence ≥ 0.9 and no multi-horse ambiguity
   auto-create a profile (`created_from_document_id`, `ocr_confidence` set).
   Everything else stays `needs_review = true` for the preview grid.
6. Coggins test dates create a `coggins` reminder one year out; health
   certificate expiry dates create a `health_cert` reminder.
7. Tier document limits are enforced before processing (403 when the batch
   would exceed the plan's document capacity).

Response: `{ ok, batchId, documents[], proposals[], skipped[], summary }`.
Each proposal carries `action` (`created` / `attached` / `review`),
`matchedHorseId`, merged `fields`, `confidenceMap`, and `ambiguous` (e.g. a
mare + foal on one paper). Render proposals as the preview grid, then resolve
reviews with:

**Commit mode** — "assign to existing horse or create new":

```jsonc
{
  "workspaceId": "…",
  "mode": "commit",
  "assignments": [
    { "documentIds": ["doc-…"], "action": "attach-horse", "horseId": "horse-…" },
    { "documentIds": ["doc-…", "doc-…"], "action": "create-horse",
      "overrides": { "name": "Spirit", "birthdate": "2019-04-12" } },
    { "documentIds": ["doc-…"], "action": "skip" }
  ]
}
```

> Note: Vercel functions accept ~4.5 MB request bodies. For larger scans,
> upload to the `horse-documents` bucket from the client first and pass
> `storagePath` instead of `contentBase64`.

### POST `/api/documents/generate-from-template`

```jsonc
{
  "workspaceId": "…",
  "templateId": "bill-of-sale",
  "horseId": "horse-…",
  "output": "pdf",                          // or "html"
  "fields": { "buyer.name": "John Smith", "sale.price": "$18,500" }
}
```

- Entitlement middleware: the template's `minimum_plan` (DB row wins over the
  built-in catalog) is checked against the workspace's effective tier. A
  `Past Due` billing state downgrades the effective tier to Starter
  (read-only premium features) until payment recovers.
- Placeholders (`{{horse.name}}`, `{{owner.name}}`, `{{today_date}}`,
  `{{health.lastCogginsDate}}`, …) are auto-filled from the horse row,
  `workspace_profiles`, the latest attached Coggins/vet documents, and
  `ownership_records`; unresolved keys render as blanks and are returned in
  `missingFields`.
- PDF output is stored as a new `documents` row and returned as
  `{ documentId, downloadUrl (1h signed), fileName, missingFields }`.

Template/tier matrix (5 per tier, higher tiers include lower):

| Plan | Templates |
|---|---|
| Starter (Basic) | Bill of Sale, Boarding Agreement, Lease Agreement, Veterinary Care Log, Coggins & Health Certificate Form |
| Professional (Pro) | + Breeding Contract, Training Agreement, Foaling & Mare Record, Sales Packet, Client Onboarding |
| Ranch Ops (Business) | + Professional Services Agreement, Liability Waiver, Multi-Owner Transfer, Branded Barn Asset Pack, Vet Invoice & Payment Plan |

### POST `/api/sale-packets` (requires Professional+)

```jsonc
{
  "workspaceId": "…",
  "horseId": "horse-…",
  "buyerName": "John Smith",          // optional
  "buyerEmail": "john@example.com",   // optional: emails the signed link
  "watermarkText": "",                // default: "Copy for <buyer> - <date>"
  "documentIds": []                    // optional subset; default: all stored docs
}
```

Assembles: generated cover sheet (horse summary, registration #, latest
Coggins date, document index) + every attached PDF (merged page-by-page) +
JPEG/PNG scans (one page each); non-embeddable files are listed on an
appendix page. A diagonal watermark is stamped on every page. The packet is
stored in the private `sale-packets` bucket, recorded in `sale_packets`, and
returned as `{ packetId, downloadUrl (1h), includedDocumentIds, emailed }`.

`GET /api/sale-packets?workspaceId=…[&horseId=…]` lists packets with fresh
signed URLs.

### GET|POST `/api/reminders/run` (cron)

Vercel cron (daily 12:00 UTC, `vercel.json`) sends
`Authorization: Bearer $CRON_SECRET`. The job finds reminders due within 7
days with `notification_sent = false`, emails the workspace operations
contact (falls back to the owner's auth email), writes a `notifications`
row, and flips `notification_sent`. Email send failures are retried on the
next run; without an email provider, reminders become in-app notifications.

### POST `/api/horses/import`

`{ workspaceId, csv }` — bulk CSV with header mapping (Name, Breed, Color,
Birth Date, Gender, Status, Registration Number, Registry, Microchip, Owner,
Barn; case-insensitive, quoted fields supported). Rows with a matching
registration number update the existing horse; others insert. Returns
`{ imported, updated, errors[] }`.

### GET `/api/horses/export?workspaceId=…&horseId=…`

Full JSON export: horse profile, all documents with extraction payloads and
1-hour signed URLs, ownership records, reminders, sale packets. Every export
is written to `audit_logs` (`horse.exported`) — this is also the integration
hook for third parties (QuickBooks et al. can poll this endpoint with a
service token).

## Subscriptions & enforcement

Stripe checkout/webhook flows already exist (`api/stripe/*`). This layer
consumes `workspace_subscription_profiles`:

- `tier` → template entitlements + document capacity
  (Starter 250 / Professional 1,000 / Ranch Ops 5,000 / Enterprise 20,000).
- `billing_state = 'Past Due'` (set by the `customer.subscription.updated`
  webhook on failed payment) → effective tier drops to Starter, blocking
  premium template generation and sale packets until payment succeeds.

## Validation flow (matches the MVP acceptance scenario)

1. Barn owner POSTs 3 PDFs (registration, Coggins, health cert) to
   `bulk-upload-with-ocr` in `auto` mode.
2. The three extractions share the registration number → one candidate →
   horse profile **Spirit** is created with registration #, breed, color;
   `created_from_document_id` points at the registration paper.
3. The Coggins test date creates a `coggins` reminder dated 12 months later;
   the daily cron emails it when it comes within 7 days.
4. All three documents are attached to Spirit (`documents.horse_id`).
5. Owner generates a Bill of Sale via `generate-from-template` (Starter plan
   includes it), then POSTs `/api/sale-packets` with the buyer's name →
   watermarked PDF bundle, signed download link, optional buyer email.

Covered by `tests/api/documentPipeline.test.mjs` (extraction, merging,
multi-horse ambiguity, threshold behavior, ZIP handling, tier ladder,
template rendering, PDF/watermark assembly). Run with `npm test`.

## Deployment

1. **Database**: `npm run supabase:prepare`, then run
   `supabase/production-schema.generated.sql` in the Supabase SQL editor (or
   apply the new migration alone on an existing database:
   `supabase/migrations/20260609_ocr_documents_sale_packets.sql`).
2. **Vercel env vars** (Server scope): existing Supabase/Stripe vars plus
   `CRON_SECRET` (required for the reminder cron), and optionally
   `OCR_PROVIDER=textract` + `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` /
   `AWS_REGION`, `RESEND_API_KEY` *or* `SENDGRID_API_KEY` +
   `EMAIL_FROM_ADDRESS`, `SUPABASE_SALE_PACKET_BUCKET` (defaults to
   `sale-packets`). See `.env.example`.
3. **Deploy**: `vercel deploy` (the SPA rewrite and the daily cron are in
   `vercel.json`). The cron requires a Vercel plan with cron support;
   alternatively hit `/api/reminders/run` from any scheduler with the
   bearer secret.
4. **Stripe**: unchanged — price IDs per tier + webhook secret as before.

## Scaling notes

- OCR latency: the client-pre-OCR path costs the API ~0 (text arrives with
  the upload). The Textract sync path handles single-page docs in 1–3 s; for
  1M+ documents move to Textract async + a queue (SQS/QStash) feeding the
  same `extractDocument` + `groupExtractionsIntoCandidates` functions, with
  `document_processing_jobs` as the job ledger (the table already tracks
  provider/status/error per document).
- Malware scanning: enable Supabase storage AV scanning or route uploads
  through an S3 + ClamAV/GuardDuty bucket before ingestion; the pipeline
  only needs `storagePath` to stay unchanged.
- All document access is signed-URL based (1 h expiry); originals are
  retained verbatim next to their OCR text for audit.
