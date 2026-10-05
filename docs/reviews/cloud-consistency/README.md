# Concurrent workspace saves (audit 10)

## Behavior

- Changed records merge non-overlapping fields against the last acknowledged
  device baseline. Competing changes to the same field/ordered array are explicit
  conflicts; an absent remote record is never silently re-created as an update.
- Updates match the current database payload and revision and verify the returned
  identity. A row changing between read and write produces no false success.
- Unchanged Admin profiles are not re-written. Profile field edits merge through
  the same guard. Specialist saves still skip the administrator profile entirely.
- Canonical columns only change when their associated field was edited here;
  explicitly null columns are preserved. Device recovery snapshots carry the
  confirmed merged row values and verified account/workspace identity.
- Requested deletes compare canonical records against the same restore context,
  then pin raw remote revision/payload and verify the removed identity. Explicit
  administrator replacement retains its separately authorized contract.
- Focus and five-minute visible-tab refresh install teammate records only while
  this device has an acknowledged clean snapshot, no pending deletion and no save
  in progress. Identity/role round trips and edits during the read invalidate it.
  Read failures are reported without replacing local records. Local auxiliary
  history is preserved even if a normalized remote read supplies empty defaults.

## Evidence

Actual cloud-service fixtures reproduce a lost vaccination after a stale
price-only save, a stale Admin save reverting business name, competing price
writes and a read/write race before the correction. The service regression set
covers merged fields, snapshot recovery, explicit nulls, access-role exclusion,
remotely removed rows, stale deletion and legacy restore normalization.

Controlled execution of actual CloudBootstrap effects covers clean refresh,
no echo-save, edits during reads, failed/changed-scope responses, round trips,
throwing snapshot capture and preservation of local packet-file references.

## Limits

These are client optimistic-concurrency protections, not a database transaction.
Existing older clients can still write unconditionally, and already-sent requests
cannot be recalled. Audit 12's proposed security-invoker transaction remains a
separate approved migration/release. A conflicting save keeps local work and
reports the field; it does not silently pick a winner.

Device-recovery snapshots are not complete shared-workspace snapshots. Shared
client audit/packet/buyer histories (audit 09), complete original-file recovery
(audit 11) have separate gates. Complete paginated reads (audit 13) are included
in this candidate because safe live refresh depends on them. Refresh
never treats empty relational history defaults as authorization to clear known
local history. No live customer mutation, migration, paid service or permission
change was used for local verification.

## Final-head review correction

Automated review identified that live refresh could accept a per-device fallback
snapshot after a relational error. Actual-effect and real-service regressions
failed before correction. Refresh now requests an authoritative relational read
bound to the captured account/ranch, refuses any changed resolved identity before
records are read, and requires the relational source/target in the response.
Recovery snapshots never become a live-refresh baseline. Manual recovery behavior
is not silently changed by this option.

Browser fixtures now honor requested PostgREST write representations instead of
returning an empty array for a successful single-row write. Existing-member
binding assertions require zero rewrites when both bindings already exist.

Further interrupted-flow checks preserve snapshot-only sessions (no unsupported
refresh timers/warnings), refuse a known pending administrator profile edit after
role demotion instead of falsely acknowledging it, and use read-only workspace
resolution during record loading. A synthetic pending-invitation case proves a
record refresh cannot invoke invitation acceptance as a side effect. Initial
sign-in's explicit workspace-access initialization remains separate.

The complete-load correction and stable normalization details are documented in
../cloud-load-completeness/README.md. A successful focus refresh installs all
1,203 synthetic rows beyond a 137-row cap; a failed later page retains all local
records and never acknowledges or echo-saves a truncated result.

## Bounded explicit replacement

An explicit Admin Push cloud batches upserts by at most100 rows and512KiB of
serialized payload (an individually larger row remains a single request). Every
batch rechecks the authenticated account, resolved ranch and Admin role. Returned
IDs, workspace IDs and payloads must match every requested row exactly; omitted,
duplicate or unexpected results are failure. No recovery fallback masks a batch
failure. Earlier successful batches can remain committed, and the error says so;
this is not an atomic transaction. Document reservation completion remains
conservative until the entire document collection is confirmed.

The existing-ID scan for explicit replacement is now counted/paginated before
that collection's writes, so capped responses cannot omit stale records. Deletion
still uses the existing per-record raw revision/payload CAS. Ordinary field merges
and no-baseline conflict checks remain per-record. Synthetic5,000/20,000-document
cases bound both write and total database requests, with row-count/byte limits,
mid-batch failures, missing confirmations, account/ranch/role changes, duplicate
source IDs and later-page failure coverage. No production bulk data was used.

Replacement batches group rows by their defined database columns and omit only
undefined top-level values. This preserves single-row behavior for older records:
missing canonical fields use defaults for inserts and remain unchanged on updates,
while explicit nulls are still sent. Tests use the installed Supabase SDK with an
intercepted synthetic transport to verify real columns/body serialization and
mixed existing-row omission behavior. Access-check exceptions and transport errors
also fail closed; no failed explicit replacement writes a recovery fallback.
