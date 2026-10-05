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
(audit 11) and complete paginated reads (audit 13) have separate gates. Refresh
never treats empty relational history defaults as authorization to clear known
local history. No live customer mutation, migration, paid service or permission
change was used for local verification.
