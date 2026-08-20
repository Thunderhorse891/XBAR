import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import path from 'node:path';

/*
 * Discover the test files and hand them to `node --test` as explicit paths.
 *
 * Discovery is the point: `npm test` used to be a hand-maintained list of every
 * test path, so a file added without editing that line was simply never run —
 * it existed, it looked like coverage, and nothing executed it. Three files
 * were in that state when this script was written.
 *
 * The obvious fix, passing a quoted glob to `node --test`, moves the problem
 * rather than solving it: the runner only expands globs itself on newer Node,
 * and this package supports Node >= 20.19 (see engines and .nvmrc). CI runs
 * Node 24, so CI would never have caught that — contributors on the version the
 * repository actually declares would find that no tests ran at all. Reading the
 * directory here works the same on every supported version.
 */

const root = process.cwd();

function discover(directory, suffix) {
  // A missing directory and an empty one are the same problem here — the build
  // or the layout changed — and both are reported the same way. Exiting green
  // on zero tests is the exact failure this script exists to prevent, so
  // neither case is allowed to pass quietly.
  let entries;
  try {
    entries = readdirSync(path.join(root, directory));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`Cannot read ${directory}, so its tests were not run: ${detail}`);
    process.exit(1);
  }

  const matches = entries.filter((name) => name.endsWith(suffix)).sort();

  if (matches.length === 0) {
    console.error(`No ${suffix} files found in ${directory} — expected compiled or source tests there.`);
    process.exit(1);
  }

  return matches.map((name) => path.join(directory, name));
}

const files = [
  // Compiled from TypeScript by `tsc -p tsconfig.test.json` before this runs.
  ...discover('.codex-test-dist/tests', '.test.js'),
  // Plain ESM, run from source.
  ...discover('tests/api', '.test.mjs'),
];

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
