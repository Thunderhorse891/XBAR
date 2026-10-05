# Autosave queue reliability

Reproduction baseline: main `076b03c8e1deae56011d962d8a904c4b8ef38d80`.
Delivery baseline: main `de684de5c6526f66d26ac4108ed50378236a67dd`, tree
`5258fa54046e8d633d36ba232f374a00fd9f3bed` (verified against GitHub).

## Reproductions

Controlled execution of the actual `CloudBootstrap` autosave effect, with only
React hooks, timers and service/store boundaries substituted:

1. Start snapshot A; edit B and expire its debounce while A is pending; resolve A.
   Baseline makes one save and drops B. The correction schedules B and leaves the
   status pending until B is acknowledged.
2. Return a failed save with no further editing or online event. Baseline leaves
   no retry; the correction retries with capped exponential backoff.
3. Reject the save promise. Baseline leaks the rejection and keeps `saving` true.
   The correction reports the failure, releases the queue in `finally`, and retries.

These three tests fail against baseline and pass with the correction. Additional
cases cover Saved only after the latest snapshot, offline/reconnect, identity or
lock changes before a response, disposal and snapshot exceptions before and after a saved response.
Account/ranch target checks also refuse replaced authentication or workspace
resolution before any cloud mutation. No live user
records or customer writes are involved.

## Scope

The retry delay starts at 1.6 seconds and doubles on failures, capped at 30 seconds.
An online event or new edit schedules another attempt. In-flight writes remain
serialized within the active autosave effect. A retired effect never publishes a
late success, settles storage reservations or acknowledges deletions into the new
workspace. Autosave supplies its captured account/ranch to the persistence layer,
which refuses a differently resolved session or ranch before mutation. Network
writes already sent cannot be cancelled by this client guard.

This narrowly addresses audit 07 and 08. It does not claim atomic multi-table
persistence, cross-device field conflict resolution, or complete recovery archives;
those are separate workstreams.

## Verification

All 156 registered Node test steps pass through the supported Node import-loader
adapter. The canonical `npm test` reaches this executor's `tsx` IPC `EPERM`
restriction; the adapter changes only the CLI startup, not test selection or
assertions. TypeScript, ESLint (four existing Fast Refresh warnings), full Prettier
and diff whitespace checks pass. Production bundle and equivalent import-loader marketing postbuild pass; canonical
postbuild has the same `tsx` IPC restriction.
Remote CI and final-head review remain release gates. These controlled tests are
not an authenticated production or physical-device sync acceptance test.
