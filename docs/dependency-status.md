# Dependency backlog reconciliation — September 17, 2026

PR #201 is reconciled with current main. Newer authentication, billing,
workspace access, document storage and native export implementations are
preserved. The duplicate August 19 RPC migration is omitted because main
contains the subsequent restricted-RPC rollout and verification.

## Consolidated updates

- Production dependency group (#211): Capacitor 8.5.1,
  PDF.js 6.3.289 and the remaining compatible package updates.
- Development dependency group (#203): Playwright 1.63.0, Vite 8.3.0,
  TypeScript ESLint 8.70.0 and related tooling.
- React and React DOM 19.2.7, with both React type packages updated together
  (#154). The older proposal did not update React DOM.
- ESLint 10 and compatible React Hooks tooling (#157); ESLint Prettier 10
  (#172); globals 17 (#151).
- Checkout, setup-node and upload-artifact v7; CodeQL action v4
  (#145, #170, #147, #146).
- React Router stays at main's newer 7.18.3; #153 proposes an older version.

The existing full main CI workflow is retained, including document/report,
password recovery, service-outage recovery and native bundle smoke tests.
This document records reconciliation scope; passing results are attached to
GitHub checks for the actual integration commit.

## Incompatible proposals

- Supabase 2.115.0: the rendered auth suite caught changed sign-out semantics.
  On a failed logout request the SDK clears the local session, redirecting away
  before the app displays the failure. Retain the proven 2.100.1 SDK until the
  sign-out flow is adapted and its full recovery suite passes. Do not weaken
  the failed-sign-out regression test to accept a lost error message.
- #173: TypeScript 7.0.2 is outside typescript-eslint 8.70.0's declared
  peer range (>=4.8.4 <6.1.0), verified against npm package metadata.
  Retain TypeScript 5.9.3 until the lint toolchain supports version 7.
- #174: Node 26 types exceed both the deployed Node 24 runtime and the
  declared Node 20.19 minimum. Retain the existing types until a separately
  verified runtime-baseline migration is ready.

These proposals should be closed with their compatibility reasons, rather
than forced into the release or left as unresolved merge conflicts.
