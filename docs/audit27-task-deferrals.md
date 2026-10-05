# Browser-local Care Tasks deferrals (audit 27)

This is a bounded correction to the live task workflow. Full workspace/cross-device task persistence remains open and requires separate schema/security approval. No SQL or cloud task-state activation is included.

## Contract

- Snooze writes and verifies an actual return date; Dismiss today is labelled accurately. Neither action mutates or marks its source record complete, and neither emits task-completed telemetry.
- Independent task keys include exact workspace/member identity (or the local workspace creation identity). Unrelated tab writes/restores cannot overwrite each other. Same-task browser preferences remain last-write-wins; browser storage is not a database transaction.
- Failed saves keep work visible. Multi-task restore reports only confirmed progress when a later write fails. Unreadable/malformed data cannot hide work indefinitely.
- Source fingerprints reveal changed care, ownership, document or buyer work, including reassigned buyer horses. Canonical useDayKey refreshes the board at local rollover and after clock/timezone changes. A valid week-long snooze tolerates westward date-line travel.
- Today excludes future and closed buyer follow-ups. HerdGroups and /today?segment retain the selected group for all four task sources. Archived horses are omitted. Queued documents open Processing, and review routes retain their horse.
- Native buttons provide keyboard actions without nested clickable rows. Scoped responsive CSS wraps long task text.

## Verification and recovery

The current-main task derivation was reproduced with a buyer due in 2099: it appeared in Today. The original Snooze callback only toasted and closed; Mark Done emitted completion before hiding a task locally. Fifteen behavior tests cover the corrected contract, including deliberate cross-tab interleavings and partial storage failures. Browser specs cover snooze/reload/expiry, group history, refusal, keyboard navigation and long mobile content.

This implementation was reconstructed after the execution workspace lost the previously reviewed local-only patch. It is a new candidate against main 356084b779f67654b17a2aa5fea21d6b8f0062ea, not a recovered copy of that old commit. Existing PR305 history is retained when updating the branch; its earlier device-global helper/tests are superseded by the scoped behavior suite.

Local Chromium currently aborts before any page is created with process-singleton socket EPERM. No local rendered/browser pass is claimed. Exact-head remote CI and final-head independent review remain release gates; passing build/Node checks alone is not workflow verification.

The final integration includes main a17aaf93 (the reviewed care-evidence fix). Task date arithmetic now delegates to its canonical addLocalCalendarDays helper; the board retains the shared buildCareBoardRows source of care verdicts. The complete main test chain is preserved with the task regression suite added once.
