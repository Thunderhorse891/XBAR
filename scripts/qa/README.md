# Local storage reconciliation diagnostic

```sh
npm run qa:storage-reconcile -- scripts/qa/storage-reconciliation.example.json
npm run test:storage-reconcile
```

Use synthetic inputs only. The runner reads one local JSON fixture. It does not connect
to a provider, ingest environment settings, change objects, apply limits, or calculate
customer-facing available storage.

- Model normal links with `document` (including generated documents), `expense-receipt`,
  `packet`, and `horse-media`. Supply raw bucket/path pairs, not signed URLs; reference
  aliases may have one leading slash. No case-folding or URL-decoding is performed.
- Model trusted object metadata separately. `bytes` must be a nonnegative safe integer,
  including zero, or `null` when unknown. Reference-declared lengths are never used.
  Duplicate same-size observations count once; contradictory sizes remain unresolved.
- List only fully enumerated fixture buckets in `completeBuckets`. No recorded object for
  a referenced path in one of these is `missing`; otherwise it is merely `unobserved`.
  `orphan` means no link in the supplied references, not authorization to delete an object.
- Known physical bytes include measured orphans and ambiguous cross-workspace links, once
  each. Workspace subtotals exclude those links rather than guessing ownership. All byte
  totals exclude unknown measurements and are lower bounds, not claims about total use.
