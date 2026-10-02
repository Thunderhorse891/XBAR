import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import handler, {
  BUYER_MEDIA_URL_TTL_SECONDS,
  isHorseMediaStoragePath,
  isStoragePathInListingGallery,
  listingWorkspaceId,
  resolveBuyerMediaUrl,
} from '../../api/_lib/buyer-media.js';

/*
 * The horse-media bucket is private, so anonymous buyers cannot mint signed
 * URLs themselves. POST /api/buyer/media signs on their behalf -- but only
 * after the share token resolves through the same RPC the buyer page uses,
 * and only for explicitly Approved storage paths in that listing's horse
 * gallery. A token for listing A must never sign media from listing B or
 * unapproved media from listing A.
 */

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';
const GALLERY_PATH = `${WORKSPACE_A}/horses/horse-abc/media-uuid-9.jpg`;
const OTHER_PATH = `${WORKSPACE_A}/horses/horse-xyz/media-uuid-10.jpg`;
// Workspace A's photo, listed in workspace B's gallery.
const FOREIGN_PATH = `${WORKSPACE_A}/horses/horse-victim/media-uuid-77.jpg`;
const LISTING_ID = 'listing-abc';

function listingWithGallery(paths, workspaceId = WORKSPACE_A) {
  return {
    sharedListing: { id: LISTING_ID, sharePath: '/profiles/horse-abc', workspaceId },
    horse: {
      id: 'horse-abc',
      gallery: paths.map((storagePath, index) => ({
        id: `media-${index}`,
        label: `Photo ${index}`,
        kind: 'Hero',
        url: '',
        status: 'Approved',
        storagePath,
      })),
    },
  };
}

function fakeSupabase({
  listing = null,
  rpcError = null,
  signedUrl = 'https://signed.example/p',
  signError = null,
  postSignListing = listing,
  postSignRpcError = rpcError,
} = {}) {
  const calls = { rpc: [], sign: [] };
  return {
    calls,
    client: {
      rpc: async (name, params) => {
        calls.rpc.push({ name, params });
        return calls.sign.length
          ? { data: postSignListing, error: postSignRpcError }
          : { data: listing, error: rpcError };
      },
      storage: {
        from: (bucket) => ({
          createSignedUrl: async (storagePath, expiresIn) => {
            calls.sign.push({ bucket, storagePath, expiresIn });
            return signError ? { data: null, error: signError } : { data: { signedUrl }, error: null };
          },
        }),
      },
    },
  };
}

const baseArgs = {
  sharePath: '/profiles/horse-abc',
  shareToken: 'token-123',
  storagePath: GALLERY_PATH,
  mediaBucket: 'horse-media',
  urlTtlSeconds: BUYER_MEDIA_URL_TTL_SECONDS,
};

test('well-formed horse-media storage paths are accepted', () => {
  assert.equal(isHorseMediaStoragePath(GALLERY_PATH), true);
  assert.equal(isHorseMediaStoragePath(`${WORKSPACE_A}/horses/horse-abc/media-uuid-9`), true);
  assert.equal(isHorseMediaStoragePath(`${WORKSPACE_A.toUpperCase()}/horses/horse-abc/media-uuid-9.jpg`), true);
});

test('malformed storage paths are rejected before any signing', () => {
  assert.equal(isHorseMediaStoragePath(''), false);
  assert.equal(isHorseMediaStoragePath(null), false);
  assert.equal(isHorseMediaStoragePath(`${WORKSPACE_A}/horses/horse-abc`), false);
  assert.equal(isHorseMediaStoragePath(`${WORKSPACE_A}/documents/horse-abc/media-uuid-9.jpg`), false);
  assert.equal(isHorseMediaStoragePath(`${WORKSPACE_A}/horses/horse-abc/document-uuid-9.jpg`), false);
  assert.equal(isHorseMediaStoragePath(`${WORKSPACE_A}/horses/../horse-abc/media-uuid-9.jpg`), false);
  assert.equal(isHorseMediaStoragePath('a/b/c/d/e.jpg'), false);
});

test('uploader-keyed and non-canonical media paths are not signable', () => {
  // The old layout keyed media by uploader, not workspace.
  assert.equal(isHorseMediaStoragePath('uploader-uuid-1/horses/horse-abc/media-uuid-9.jpg'), false);
  for (const traversal of [
    `${WORKSPACE_B}/horses/..%2f..%2f${WORKSPACE_A}/media-1.jpg`,
    `${WORKSPACE_A}/horses/%2e%2e/media-1.jpg`,
    `${WORKSPACE_A}/horses/.%2E/media-1.jpg`,
    `${WORKSPACE_A}/horses/..\\x/media-1.jpg`,
    `${WORKSPACE_A}/horses/.hidden/media-1.jpg`,
    `${WORKSPACE_A}/horses//media-1.jpg`,
    `/${WORKSPACE_A}/horses/x/media-1.jpg`,
  ]) {
    assert.equal(isHorseMediaStoragePath(traversal), false, traversal);
  }
});

test('buyer gallery membership requires an exact path and explicit approval', () => {
  const listing = listingWithGallery([GALLERY_PATH]);
  assert.equal(isStoragePathInListingGallery(listing, GALLERY_PATH), true);
  assert.equal(isStoragePathInListingGallery(listing, OTHER_PATH), false);
  assert.equal(isStoragePathInListingGallery({ horse: {} }, GALLERY_PATH), false);
  assert.equal(isStoragePathInListingGallery(null, GALLERY_PATH), false);
  assert.equal(
    isStoragePathInListingGallery({ horse: { gallery: [null, { storagePath: GALLERY_PATH }] } }, GALLERY_PATH),
    false,
  );
});

for (const status of ['Pending', 'Rejected', undefined, null, '', 'approved', 'Unknown']) {
  test(`a matching photo with status ${String(status)} signs nothing`, async () => {
    const listing = listingWithGallery([GALLERY_PATH, OTHER_PATH]);
    listing.horse.gallery[0].status = status;
    // Another approved photo must not authorize the requested unapproved one.
    const { client, calls } = fakeSupabase({ listing });
    const result = await resolveBuyerMediaUrl({ ...baseArgs, supabase: client });
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.deepEqual(calls.sign, []);
  });
}

test('an approved photo still signs when other gallery photos need review', async () => {
  const listing = listingWithGallery([OTHER_PATH, GALLERY_PATH]);
  listing.horse.gallery[0].status = 'Pending';
  const { client, calls } = fakeSupabase({ listing });
  const result = await resolveBuyerMediaUrl({ ...baseArgs, supabase: client });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.sign, [
    { bucket: 'horse-media', storagePath: GALLERY_PATH, expiresIn: BUYER_MEDIA_URL_TTL_SECONDS },
  ]);
});

test('withdrawing photo approval prevents the next signing request', async () => {
  const listing = listingWithGallery([GALLERY_PATH]);
  const { client, calls } = fakeSupabase({ listing });
  assert.equal((await resolveBuyerMediaUrl({ ...baseArgs, supabase: client })).ok, true);
  listing.horse.gallery[0].status = 'Rejected';
  const result = await resolveBuyerMediaUrl({ ...baseArgs, supabase: client });
  assert.equal(result.status, 403);
  assert.equal(result.ok, false);
  assert.equal(calls.sign.length, 1);
  assert.equal(calls.rpc.length, 3);
});

for (const status of ['Pending', 'Rejected', undefined]) {
  test(`approval changed to ${String(status)} during signing discards the URL`, async () => {
    const postSignListing = listingWithGallery([GALLERY_PATH]);
    postSignListing.horse.gallery[0].status = status;
    const { client, calls } = fakeSupabase({
      listing: listingWithGallery([GALLERY_PATH]),
      postSignListing,
    });
    const result = await resolveBuyerMediaUrl({ ...baseArgs, supabase: client });
    assert.equal(calls.sign.length, 1);
    assert.equal(result.status, 403);
    assert.equal(result.ok, false);
    assert.equal(result.url, undefined);
  });
}

test('a photo removed during signing is not returned to the buyer', async () => {
  const { client, calls } = fakeSupabase({
    listing: listingWithGallery([GALLERY_PATH]),
    postSignListing: listingWithGallery([OTHER_PATH]),
  });
  const result = await resolveBuyerMediaUrl({ ...baseArgs, supabase: client });
  assert.equal(calls.sign.length, 1);
  assert.equal(result.status, 403);
  assert.equal(result.ok, false);
  assert.equal(result.url, undefined);
});

test('a listing access change during signing discards the URL', async () => {
  const { client, calls } = fakeSupabase({
    listing: listingWithGallery([GALLERY_PATH]),
    postSignListing: null,
  });
  const result = await resolveBuyerMediaUrl({ ...baseArgs, supabase: client });
  assert.equal(calls.sign.length, 1);
  assert.equal(result.status, 404);
  assert.equal(result.ok, false);
  assert.equal(result.url, undefined);
});

test('a failed approval recheck discards the URL even if it returns stale listing data', async () => {
  const { client, calls } = fakeSupabase({
    listing: listingWithGallery([GALLERY_PATH]),
    postSignRpcError: new Error('read failed'),
  });
  const result = await resolveBuyerMediaUrl({ ...baseArgs, supabase: client });
  assert.equal(calls.sign.length, 1);
  assert.equal(result.status, 404);
  assert.equal(result.ok, false);
  assert.equal(result.url, undefined);
});

test('a malformed storage path is refused without touching the database', async () => {
  const { client, calls } = fakeSupabase({ listing: listingWithGallery([GALLERY_PATH]) });
  const result = await resolveBuyerMediaUrl({ ...baseArgs, supabase: client, storagePath: 'nope' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 400);
  assert.deepEqual(calls.rpc, []);
  assert.deepEqual(calls.sign, []);
});

test('an unresolvable share token signs nothing', async () => {
  const { client, calls } = fakeSupabase({ listing: null });
  const result = await resolveBuyerMediaUrl({ ...baseArgs, supabase: client });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.deepEqual(calls.sign, []);
});

test('an RPC failure signs nothing', async () => {
  const { client, calls } = fakeSupabase({ rpcError: new Error('db down') });
  const result = await resolveBuyerMediaUrl({ ...baseArgs, supabase: client });
  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.deepEqual(calls.sign, []);
});

test("a token for one listing cannot sign another listing's media", async () => {
  // The listing resolves (valid token) but the requested path is not in its
  // gallery: 403, and the service-role signer is never reached.
  const { client, calls } = fakeSupabase({ listing: listingWithGallery([GALLERY_PATH]) });
  const result = await resolveBuyerMediaUrl({ ...baseArgs, supabase: client, storagePath: OTHER_PATH });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.deepEqual(calls.sign, []);
});

test('a storage failure is reported, not hidden', async () => {
  const { client } = fakeSupabase({
    listing: listingWithGallery([GALLERY_PATH]),
    signError: new Error('signing down'),
  });
  const result = await resolveBuyerMediaUrl({ ...baseArgs, supabase: client });
  assert.equal(result.ok, false);
  assert.equal(result.status, 502);
});

test('the happy path signs the exact gallery path with the listing-aligned TTL', async () => {
  const { client, calls } = fakeSupabase({ listing: listingWithGallery([GALLERY_PATH]) });
  const result = await resolveBuyerMediaUrl({ ...baseArgs, supabase: client });
  assert.equal(result.ok, true);
  assert.equal(result.url, 'https://signed.example/p');
  assert.deepEqual(calls.sign, [
    { bucket: 'horse-media', storagePath: GALLERY_PATH, expiresIn: BUYER_MEDIA_URL_TTL_SECONDS },
  ]);
  assert.equal(BUYER_MEDIA_URL_TTL_SECONDS, 3600);
});

test("an approved gallery entry pointing at another workspace's photo signs nothing", async () => {
  // Workspace B's owner lists workspace A's photo path in B's own gallery and
  // approves it. The listing resolves, the path is "approved" -- but the file
  // is not B's, so the service role must not sign it.
  const { client, calls } = fakeSupabase({ listing: listingWithGallery([FOREIGN_PATH], WORKSPACE_B) });
  const result = await resolveBuyerMediaUrl({ ...baseArgs, supabase: client, storagePath: FOREIGN_PATH });
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.deepEqual(calls.sign, []);
});

test('the owning workspace comes from the resolved listing row itself, not a second lookup', async () => {
  // No second "which row does this share path mean" query that could pick a
  // different workspace than the resolver did.
  const { client, calls } = fakeSupabase({ listing: listingWithGallery([GALLERY_PATH]) });
  assert.equal((await resolveBuyerMediaUrl({ ...baseArgs, supabase: client })).ok, true);
  assert.equal(client.from, undefined, 'the handler must not query tables beside the resolver');
  assert.deepEqual(
    calls.rpc.map((call) => call.name),
    ['xbar_resolve_public_listing', 'xbar_resolve_public_listing'],
  );
  assert.equal(listingWorkspaceId(listingWithGallery([], WORKSPACE_A.toUpperCase())), WORKSPACE_A);
});

for (const [label, workspaceId] of [
  ['a resolver that returns no workspace (migration not applied)', undefined],
  ['an empty workspace', ''],
  ['a workspace that is not a uuid', 'workspace-a'],
  ['a different workspace', WORKSPACE_B],
]) {
  test(`${label} signs nothing`, async () => {
    const listing = listingWithGallery([GALLERY_PATH], workspaceId);
    if (workspaceId === undefined) delete listing.sharedListing.workspaceId;
    const { client, calls } = fakeSupabase({ listing });
    const result = await resolveBuyerMediaUrl({ ...baseArgs, supabase: client });
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.deepEqual(calls.sign, []);
  });
}

test('a listing that changes workspace during signing discards the URL', async () => {
  // The recheck holds the workspace to the same rule as the first read.
  const { client, calls } = fakeSupabase({
    listing: listingWithGallery([GALLERY_PATH]),
    postSignListing: listingWithGallery([GALLERY_PATH], WORKSPACE_B),
  });
  const result = await resolveBuyerMediaUrl({ ...baseArgs, supabase: client });
  assert.equal(calls.sign.length, 1);
  assert.equal(result.ok, false);
  assert.equal(result.status, 403);
  assert.equal(result.url, undefined);
});

test('a resolved listing without sharedListing signs nothing', async () => {
  const listing = listingWithGallery([GALLERY_PATH]);
  delete listing.sharedListing;
  const { client, calls } = fakeSupabase({ listing });
  const result = await resolveBuyerMediaUrl({ ...baseArgs, supabase: client });
  assert.equal(result.status, 403);
  assert.deepEqual(calls.sign, []);
});

test('the resolver returns the workspace of the row it resolved, after every payload key', () => {
  const expand = readMigrationFile('20261001090000_workspace_keyed_storage_expand.sql');
  const start = expand.indexOf('create or replace function public.xbar_resolve_public_listing_legacy(');
  assert.ok(start > -1, 'the expand migration must return the listing workspace');
  const body = expand.slice(start, expand.indexOf('$function$;', start));
  // Built after `listing_row.payload ||`, so an owner-written payload key named
  // workspaceId cannot stand in for the real one.
  assert.match(
    body,
    /listing_row\.payload\s*\|\|\s*jsonb_build_object\([\s\S]*'workspaceId', listing_row\.workspace_id\s*\)/,
  );
  // Otherwise the resolver is the one already live: same row choice, same
  // release and token checks.
  const previous = readMigrationFile('20260911003739_share_release_selected_row.sql');
  const prevBody = previous.slice(
    previous.indexOf('create or replace function public.xbar_resolve_public_listing_legacy('),
    previous.indexOf('$function$;'),
  );
  const strip = (sql) =>
    sql
      .replace(/--[^\n]*/g, '')
      .replace(/,\s*'workspaceId', listing_row\.workspace_id/, '')
      .replace(/\s+/g, ' ')
      .trim();
  assert.equal(strip(body), strip(prevBody));
});

test('the token is passed through to the listing RPC for validation', async () => {
  const { client, calls } = fakeSupabase({ listing: listingWithGallery([GALLERY_PATH]) });
  await resolveBuyerMediaUrl({ ...baseArgs, supabase: client });
  assert.equal(calls.rpc.length, 2);
  assert.equal(calls.rpc[0].name, 'xbar_resolve_public_listing');
  assert.equal(calls.rpc[0].params.p_share_path, '/profiles/horse-abc');
  assert.equal(calls.rpc[0].params.p_share_token, 'token-123');
  assert.deepEqual(calls.rpc[1], calls.rpc[0]);
});

function mockReqRes({ method = 'POST', body = undefined } = {}) {
  const headers = {};
  const chunks = [];
  const req = {
    method,
    headers: {},
    socket: {},
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) {
        yield Buffer.from(JSON.stringify(body));
      }
    },
  };
  const res = {
    headers,
    statusCode: 200,
    body: '',
    setHeader(name, value) {
      headers[name] = value;
    },
    end(chunk) {
      this.body = String(chunk ?? '');
    },
  };
  return { req, res, chunks };
}

test('non-POST requests are refused', async () => {
  const { req, res } = mockReqRes({ method: 'GET' });
  await handler(req, res);
  assert.equal(res.statusCode, 405);
});

test('an invalid body is refused before any service call', async () => {
  const { req, res } = mockReqRes({ body: { sharePath: '/profiles/x' } });
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).ok, false);
});

test('the migration flips the bucket private with a workspace-scoped read policy', () => {
  const migration = readFileSync(
    path.join(process.cwd(), 'supabase', 'migrations', '20260924134000_horse_media_private_signed_urls.sql'),
    'utf8',
  );
  // The bucket itself goes private...
  assert.match(migration, /update storage\.buckets\s+set public = false\s+where id = 'horse-media'/);
  // ...with a read policy that keys membership to the canonical workspace
  // access function rather than re-deriving it inline...
  assert.match(migration, /create policy "horse media select workspace"/);
  assert.match(migration, /public\.xbar_has_workspace_access/);
  // ...grants the bucket nothing to anonymous callers...
  assert.ok(!migration.includes('to anon'));
  // ...guards the gallery expansion against corrupt non-array payloads (a
  // throwing RLS policy is an outage, not a denial)...
  assert.match(migration, /jsonb_typeof\(h\.payload -> 'gallery'\) = 'array'/);
  // ...and ships rollback instructions, because contract #15 forbids applying
  // this without Erin's explicit approval.
  assert.match(migration, /ROLLBACK/i);
});

function readMigrationFile(name) {
  return readFileSync(path.join(process.cwd(), 'supabase', 'migrations', name), 'utf8');
}

function policyBody(sql, name) {
  const start = sql.indexOf(`create policy "${name}"`);
  assert.ok(start > -1, `${name} is not created`);
  const end = sql.indexOf(');\n', start);
  return sql.slice(start, end);
}

const UPLOADER_BRANCH = /auth\.uid\(\)\)?(?:::text)? = split_part\(name/;

test('the expand phase closes the gallery read and adds workspace writes, keeping old clients working', () => {
  const expand = readMigrationFile('20261001090000_workspace_keyed_storage_expand.sql');
  // A gallery listing no longer grants a read.
  assert.ok(!expand.includes('jsonb_array_elements'), 'a gallery listing must not grant a read');
  const select = policyBody(expand, 'horse media select workspace');
  assert.match(select, /xbar_has_workspace_access\(split_part\(name, '\/', 1\)::uuid\)/);
  // Inserts follow the uploadMedia grant...
  const insert = policyBody(expand, 'horse media insert workspace');
  assert.ok(!UPLOADER_BRANCH.test(insert), 'the workspace insert must not take an uploader-keyed path');
  assert.match(insert, /xbar_has_workspace_capability\(split_part\(name, '\/', 1\)::uuid, 'uploadMedia'\)/);
  // ...and nothing grants UPDATE on a photo: no client renames one, and an
  // UPDATE is a move -- out of the ranch, or out from under its gallery.
  assert.ok(!/create policy "horse media update/.test(expand), 'a photo UPDATE policy was created');
  assert.match(expand, /drop policy if exists "horse media update workspace" on storage\.objects;/);
  // Expand drops nothing an already-loaded client still uses: it uploads
  // (insert) and reads under its own id...
  for (const kept of ['horse media upload own', 'horse documents read own', 'horse documents upload own']) {
    assert.ok(!expand.includes(`drop policy if exists "${kept}"`), `${kept} must survive until the contract phase`);
  }
  // ...but no client updates or moves an object, and an uploader-keyed UPDATE
  // policy beside a workspace one lets a member move a ranch file out of the
  // ranch (permissive USING and WITH CHECK are ORed separately).
  for (const dropped of ['horse media update own', 'horse documents update own']) {
    assert.match(expand, new RegExp(`drop policy if exists "${dropped}" on storage\\.objects;`), dropped);
  }
  assert.ok(!expand.includes('to anon'));
});

test('the contract phase leaves no uploader-keyed branch in either private bucket', () => {
  const contract = readMigrationFile('20261001090100_workspace_keyed_storage_contract.sql');
  for (const legacy of [
    'horse media upload own',
    'horse media update own',
    'horse documents read own',
    'horse documents upload own',
    'horse documents update own',
  ]) {
    assert.match(contract, new RegExp(`drop policy if exists "${legacy}" on storage\\.objects;`), legacy);
    assert.ok(!contract.includes(`create policy "${legacy}"`), `${legacy} is recreated`);
  }
  // The workspace policies that 20260912060000 builds WITH an uploader branch
  // are rebuilt here without one, so the result does not depend on whether
  // that deferred migration ever ran.
  for (const name of [
    'horse media select workspace',
    'horse documents select workspace',
    'horse documents update workspace',
  ]) {
    assert.ok(!UPLOADER_BRANCH.test(policyBody(contract, name)), `${name} still has an uploader-keyed branch`);
  }
  assert.ok(!UPLOADER_BRANCH.test(contract), 'an uploader-keyed branch survived somewhere in the contract phase');
  // ...and those rebuilt policies are the only ones on the bucket that a later
  // migration has touched: nothing after the contract phase re-adds a branch.
  const later = readdirSync(path.join(process.cwd(), 'supabase', 'migrations'))
    .filter((name) => name.endsWith('.sql') && name > '20261001090100_workspace_keyed_storage_contract.sql')
    .map(readMigrationFile);
  for (const sql of later) {
    assert.ok(!/horse (media|documents) [a-z ]+"[\s\S]*?auth\.uid\(\)/.test(sql), 'a later migration re-adds one');
  }
  assert.match(contract, /^begin;/m);
  assert.match(contract, /^commit;/m);
});

test('the runbook never applies the superseded document contract after the storage contract', () => {
  // 20260912060000 rebuilds the document policies WITH the uploader branch, so
  // following a runbook that ran it after 20261001090100 would silently undo
  // the contract phase.
  const readme = readFileSync(path.join(process.cwd(), 'README.md'), 'utf8');
  const superseded = readme.indexOf('-f supabase/migrations/20260912060000_workspace_keyed_document_storage.sql');
  const expand = readme.indexOf('-f supabase/migrations/20261001090000_workspace_keyed_storage_expand.sql');
  const expandCheck = readme.indexOf('-f supabase/checks/workspace-keyed-storage-expand.sql');
  const contract = readme.indexOf('-f supabase/migrations/20261001090100_workspace_keyed_storage_contract.sql');
  const finalCheck = readme.indexOf('-f supabase/checks/workspace-keyed-storage.sql');
  assert.ok(superseded > -1 && contract > -1, 'both must stay in the runbook');
  assert.ok(superseded < expand, 'the superseded contract must come before step 11');
  assert.ok(expand < expandCheck && expandCheck < contract && contract < finalCheck, 'expand, check, contract, check');
  assert.equal(
    readme.indexOf('-f supabase/migrations/20260912060000_workspace_keyed_document_storage.sql', superseded + 1),
    -1,
    'the superseded contract appears twice',
  );
});

test('CI proves the storage policies under real RLS, through both phases', () => {
  const workflow = readFileSync(path.join(process.cwd(), '.github', 'workflows', 'storage-database.yml'), 'utf8');
  const order = [
    '-f supabase/checks/storage-fixture-schema.sql',
    '-f supabase/checks/workspace-keyed-storage-expand.sql',
    '-f supabase/migrations/20261001090000_workspace_keyed_storage_expand.sql',
    '-f supabase/checks/workspace-keyed-storage-expand.sql',
    '-f supabase/migrations/20261001090100_workspace_keyed_storage_contract.sql',
    '-f supabase/checks/workspace-keyed-storage.sql',
  ];
  let at = -1;
  for (const step of order) {
    const next = workflow.indexOf(step, at + 1);
    assert.ok(next > at, `${step} is missing or out of order`);
    at = next;
  }
  // The first expand-window check must FAIL on the old policies -- and for the
  // gallery leak itself, not for any error, which would prove nothing.
  assert.match(
    workflow,
    /if out=\$\(psql -v ON_ERROR_STOP=1 -f supabase\/checks\/workspace-keyed-storage-expand\.sql 2>&1\); then/,
  );
  assert.match(workflow, /grep -q 'Another ranch read a photo by listing it in its own gallery'/);
  // And the superseded migrations must refuse to run after the contract.
  assert.match(workflow, /grep -q 'Superseded by 20261001090000\/20261001090100'/);
});
