# Complete, deterministic cloud reads (audit 06 / 13)

The real loader and CloudBootstrap focus effect reproduced a 1,203-row ranch
shrinking to a 137-row server cap. Every operational collection now uses exact
counts, deterministic ID ordering, pages advanced by actual returned rows, and
a second full selected-row content verification pass. Missing counts, failed/truncated pages, duplicate
IDs and changed content/revisions/counts refuse installation and recovery fallback.

The loader uses the common store restore/export contract before reconciliation.
Object keys and identified top-level collection ordering are not edits; nested
array ordering still matters. Failed reads lock even a fresh empty device; only
a confirmed empty or missing workspace permits setup.

Default owner/proof identities are deterministic in the common normalizer so
independently restored raw local and cloud records agree. A legacy membership
without its payload ID uses its verified database ID. Missing membership or
invitation historical dates fail explicitly instead of becoming today's date.
Malformed existing profiles cannot become blank authoritative profiles.

Public Link and archived listings may legitimately be tokenless and remain so
through load and store restore. Missing historical listing dates stay unknown.
Active private listings missing their persisted credential fail before install.
An explicit public-to-private user action creates a missing random credential;
existing credentials and issuance dates remain unchanged.

Update conflict comparisons understand additive defaults and documented profile
trimming. Only the verified local delta is applied to the raw remote payload;
unknown fields/unrecognized values and raw payload/revision CAS remain intact.

## Evidence and limits

Controlled tests execute actual cloud loading and refresh effects, reduced caps,
failed later pages, malformed payloads, identity/revision changes, direct raw-local
versus cloud normalization, missing credentials and actual store transitions.
Browser fixtures model real count/range/identity metadata rather than weakening
production completeness checks. This candidate was reconstructed from current
main and remote PR334 after loss of an unpublished local checkout; its tests and
review must be rerun against this new immutable candidate.

These reads are not a cross-table transactional snapshot. Arbitrary synthetic IDs
already persisted by older clients and local-only histories can still require
explicit conflict/recovery review; they are never silently discarded. Shared
history (09), original-byte recovery (11) and atomic writes (12) remain separate.
No schema, permissions, customer records or paid services are changed here.

## Same-revision changes

A legacy writer can change listing state, token, channels, or other payload data
without advancing its day-level timestamp. Both passes therefore select the same
full row projection, including canonical membership fields, and compare semantic
JSON content. Object-key reordering is ignored; ordered arrays remain meaningful.
This adds a second payload read and does not claim a database snapshot transaction.

Browser fixtures now pin one complete logical hydration as exactly two successful
counted horse reads for the same ranch. Held reads target the relational source,
not recovery fallback. Cold-owner success uses complete relational data; failed
record reads retain local notes and authoritative entitlements without autosaving
or installing recovery snapshots. CI's prior failures and new regression logs
are preserved separately from the repository.
