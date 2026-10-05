# Late gallery review reconciliation

Baseline: released main ced6cd5b1e8c9d0ac73343efcc79e0fe0c926421.

The last-photo removal finding reproduces against that baseline: the actual store removes the image while keeping score100, a Ready packet and socialReady=true. Four focused cases fail, including archived/unreviewed/wrong-horse Media Kits that cannot justify readiness.

The correction uses the existing evidence-based sale-readiness calculator only when a horse gains or loses its last real photo. This recomputes a bounded score from present records instead of guessing an irreversible historical upload bonus that may have been capped. The photo blocker returns on removal; unrelated blockers remain. A separately linked Ready Media Kit can retain social/packet readiness. Selecting a primary or removing one of several photos preserves existing readiness. Upload uses the same transition against current store state after storage finishes, and restore/repeated removal cannot inflate the score. No new persisted fields or migration are introduced.

The chunk-view download finding is not reproducible on the actual merged source: `downloadStoredFile.ts` already copies each view with `new Uint8Array(value).buffer`. A new behavioral regression passes with nonzero offsets, extra backing-buffer bytes and reused backing memory. No download implementation change is made.

The raw anonymous RPC gallery finding is valid and remains tracked by PR340's separate server projection. Client filtering cannot close that boundary. This follow-up does not claim the SQL is applied or that public raw-response privacy is resolved.

Focused tests:34 pass after correction, with4 store failures before. All65 backup/restore tests pass; the source-location assertion now follows the blocker read into its helper and malformed-state refusal is unchanged. An actual browser flow removes the last photo, reloads, restores and reloads again while checking visible gallery state and persisted readiness. Full checks, independent review and exact-head browser/production gates remain required.
