// Local QA diagnostic only. It deliberately has no provider client or environment reader.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const SOURCES = new Set(['document', 'expense-receipt', 'packet', 'horse-media']);

function validateBucket(bucket) {
  if (typeof bucket !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(bucket)) {
    throw new TypeError('Expected a literal fixture bucket name');
  }
  return bucket;
}

function canonicalPath(path, isReference) {
  if (typeof path !== 'string') throw new TypeError('Expected a fixture object path');
  const key = isReference && path.startsWith('/') ? path.slice(1) : path;
  if (
    key.includes('\\') ||
    [...key].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    key.split('/').some((part) => part === '' || part === '.' || part === '..')
  ) {
    throw new TypeError('Expected an unambiguous fixture object path');
  }
  return key;
}

function addBytes(left, right) {
  const total = left + right;
  if (!Number.isSafeInteger(total)) throw new RangeError('Fixture byte total exceeds safe integers');
  return total;
}

function validateRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new TypeError('Expected a fixture row object');
  }
}

export function reconcileStorageFixture(input) {
  if (!input || input.mode !== 'synthetic') throw new TypeError('Expected synthetic fixture mode');
  const { references, objects, completeBuckets } = input;
  if (![references, objects, completeBuckets].every(Array.isArray)) {
    throw new TypeError('Expected references, objects and completeBuckets fixture arrays');
  }
  const coverage = new Set(completeBuckets.map(validateBucket));
  const records = new Map();

  function findRecord(row, isReference) {
    validateRow(row);
    const bucket = validateBucket(row.bucket);
    const path = canonicalPath(row.path, isReference);
    const key = `${bucket}/${path}`;
    if (!records.has(key)) {
      records.set(key, {
        bucket,
        path,
        sources: new Set(),
        workspaces: new Set(),
        sizes: new Set(),
        observed: false,
      });
    }
    return records.get(key);
  }

  for (const reference of references) {
    const record = findRecord(reference, true);
    const { source, workspace } = reference;
    if (!SOURCES.has(source)) throw new TypeError('Expected a known fixture reference source');
    if (typeof workspace !== 'string' || !workspace || workspace.trim() !== workspace) {
      throw new TypeError('Expected a fixture workspace ID');
    }
    record.sources.add(source);
    record.workspaces.add(workspace);
  }

  for (const object of objects) {
    const record = findRecord(object, false);
    record.observed = true;
    if (object.bytes === null) continue;
    if (!Number.isSafeInteger(object.bytes) || object.bytes < 0) {
      throw new TypeError('Expected trusted fixture object bytes or null');
    }
    record.sizes.add(object.bytes);
  }

  const totals = { knownBytes: 0, referencedBytes: 0, orphanBytes: 0 };
  const workspaceTotals = new Map();
  const entries = [...records.keys()].sort().map((key) => {
    const { bucket, path, sources, workspaces, sizes, observed } = records.get(key);
    const link = sources.size ? 'referenced' : 'orphan';
    const sizeConflict = sizes.size > 1;
    const bytes = sizes.size === 1 ? sizes.values().next().value : null;
    const state = !observed
      ? coverage.has(bucket)
        ? 'missing'
        : 'unobserved'
      : bytes === null
        ? 'unknown-size'
        : 'measured';
    if (bytes !== null) {
      totals.knownBytes = addBytes(totals.knownBytes, bytes);
      const category = link === 'orphan' ? 'orphanBytes' : 'referencedBytes';
      totals[category] = addBytes(totals[category], bytes);
      if (workspaces.size === 1) {
        const workspace = workspaces.values().next().value;
        workspaceTotals.set(workspace, addBytes(workspaceTotals.get(workspace) ?? 0, bytes));
      }
    }
    return {
      bucket,
      path,
      link,
      state,
      bytes,
      sizeConflict,
      sources: [...sources].sort(),
      workspaces: [...workspaces].sort(),
    };
  });
  const workspaceKnownBytes = [...workspaceTotals.keys()]
    .sort()
    .map((workspace) => ({ workspace, bytes: workspaceTotals.get(workspace) }));
  return { mode: 'synthetic', entries, totals, workspaceKnownBytes };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node <script> <synthetic-fixture.json>');
    const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
    process.stdout.write(`${JSON.stringify(reconcileStorageFixture(input), null, 2)}\n`);
  } catch {
    // Never echo input identifiers or paths (including exceptions from JSON.parse/readFile).
    process.stderr.write('Storage fixture rejected. Supply one valid synthetic JSON fixture.\n');
    process.exitCode = 1;
  }
}
