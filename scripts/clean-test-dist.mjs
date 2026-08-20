import { rmSync } from 'node:fs';

/*
 * Remove the compiled test output before `tsc -p tsconfig.test.json` rebuilds it.
 *
 * `.codex-test-dist/` is gitignored and was never cleaned, so it accumulated
 * output from test files that have since been moved or deleted. Those leftovers
 * are not harmless: `npm test` now discovers compiled tests by glob, and a stale
 * artifact whose imports no longer resolve fails the run on a developer's
 * machine while CI — which always starts from a fresh clone — passes. Cleaning
 * first makes the local run match CI exactly.
 */
rmSync(new URL('../.codex-test-dist', import.meta.url), { recursive: true, force: true });
