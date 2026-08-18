# Dependency status — August 2026

A record of the Dependabot backlog pass: what was taken, and for what was
not, the specific condition that has to change first. The point of the second
list is so nobody re-opens these, re-runs the same install, and re-discovers
the same wall.

Everything taken below was verified against the full gate `ci.yml` runs — lint,
`format:check`, `tsc --noEmit`, `npm test`, `npm run build`,
`npm audit --omit=dev --audit-level=high`, prod-smoke and e2e.

## Taken

| Dependabot PR          | Change                                                                                                                                                                                        |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #199                   | dev-dependencies group, 8 packages (vite 8.2.1, @playwright/test 1.62.1, prettier 3.9.6, typescript-eslint 8.67, postcss, autoprefixer, @vitejs/plugin-react, eslint-plugin-react-refresh)    |
| #200                   | production-minor-patch group, 20 packages (@supabase/supabase-js 2.112.3, @capacitor/\* 8.5.0, lucide-react 1.31, react-hook-form 7.85, @hookform/resolvers 5.8, sonner 2.0.8, the Radix set) |
| #172                   | eslint-config-prettier 9 → 10                                                                                                                                                                 |
| #151                   | globals 15 → 17                                                                                                                                                                               |
| #157                   | @eslint/js 9 → 10, plus eslint 9 → 10 and eslint-plugin-react-hooks 5 → 7, which it needs and did not include                                                                                 |
| #153                   | react-router-dom 6.30.4 → 7.18.2                                                                                                                                                              |
| #154                   | react 18.3.1 → 19.2.7, plus react-dom and @types/react-dom, which it left behind                                                                                                              |
| #145, #170, #147, #146 | actions/checkout v7, actions/setup-node v7, actions/upload-artifact v7, github/codeql-action v4                                                                                               |

Two of these were not mergeable as Dependabot wrote them. #157 raised
`@eslint/js` alone, which peers on `eslint@^10`; moving eslint then hit
`eslint-plugin-react-hooks@5.2.0`, which caps at eslint ^9. #154 raised
`react` while leaving `react-dom` a major behind — the exact mismatch that
produced this repo's blank-white-screen bug and the reason
`tests/prod-smoke/` exists.

Two follow-on notes worth keeping:

- **eslint 10 promotes `no-useless-assignment` into `js.configs.recommended`.**
  It found four real dead stores (`src/lib/buyerVerify.ts`, and `parsed` in
  three `tests/api/*.test.mjs` helpers) — `= null` initializers overwritten by
  both the try and the catch branch before any read. Fixed at the source.
- **react-router 7 renders navigations inside a transition**, so the outgoing
  route stays mounted for a beat after a click. Two e2e assumptions broke on
  that and were corrected in `tests/e2e/workspace-setup.spec.ts`: a retry
  `page.goto` that raced the app's own redirect to the same URL, and an
  assertion that read the still-mounted dashboard. Assert on `toHaveURL`
  before asserting on content in this suite.

## Held, with the condition to unblock

### #173 — typescript 5.9.3 → 7.0.2

**Blocked on typescript-eslint.** Not a version-range guess; the package
refuses at runtime and `npm run lint` exits 2:

```
Error: typescript-eslint does not support TS 7.0.
```

typescript-eslint 8.67 is the current release and declares
`typescript: ">=4.8.4 <6.1.0"`. TS 7 also removes `baseUrl`, so `tsconfig.json`
needs its `paths` made relative in the same change:

```
tsconfig.json(18,5): error TS5102: Option 'baseUrl' has been removed.
```

**Unblock when** typescript-eslint ships TS 7 support. Then take TS 7 and the
`tsconfig` change together.

### #174 — @types/node 20.19.37 → 26.1.1

**Blocked on a decision, not a tool.** Type definitions should not describe a
newer runtime than the project promises to run on, or `tsc` will accept APIs
that are absent in production. Right now the project says three different
things:

| Declares                      | Value              |
| ----------------------------- | ------------------ |
| `package.json` `engines.node` | `>=20.19.0`        |
| `.nvmrc`                      | `20.19`            |
| `.github/workflows/ci.yml`    | `node-version: 24` |

Node 20 is past end-of-life, so the floor is stale as well as inconsistent.
Raising it is a deliberate call, not a dependency bump: Vercel derives the
serverless function runtime from `engines.node`, so changing it changes what
production runs. That could not be checked from the session that wrote this —
the environment's network policy blocks the deployment host.

**Unblock by** picking one Node baseline, setting `engines.node` and `.nvmrc`
and the CI `node-version` to it together, confirming Vercel offers that
runtime, and only then taking the matching `@types/node` major.

### #156 — pdfjs-dist 5.6.205 → 6.1.200

**Obsolete — close it.** `main` is already on 6.2.108 (PR #197). Merging this
would be a downgrade. Dependabot closes such PRs itself once a newer version
lands on the base branch.
