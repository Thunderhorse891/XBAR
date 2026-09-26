import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import handler, {
  BUYER_MEDIA_URL_TTL_SECONDS,
  isHorseMediaStoragePath,
  isStoragePathInListingGallery,
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

const GALLERY_PATH = 'uploader-uuid-1/horses/horse-abc/media-uuid-9.jpg';
const OTHER_PATH = 'uploader-uuid-2/horses/horse-xyz/media-uuid-10.jpg';

function listingWithGallery(paths) {
  return {
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
  assert.equal(isHorseMediaStoragePath('uploader-uuid-1/horses/horse-abc/media-uuid-9'), true);
});

test('malformed storage paths are rejected before any signing', () => {
  assert.equal(isHorseMediaStoragePath(''), false);
  assert.equal(isHorseMediaStoragePath(null), false);
  assert.equal(isHorseMediaStoragePath('uploader-uuid-1/horses/horse-abc'), false);
  assert.equal(isHorseMediaStoragePath('uploader-uuid-1/documents/horse-abc/media-uuid-9.jpg'), false);
  assert.equal(isHorseMediaStoragePath('uploader-uuid-1/horses/horse-abc/document-uuid-9.jpg'), false);
  assert.equal(isHorseMediaStoragePath('uploader-uuid-1/horses/../horse-abc/media-uuid-9.jpg'), false);
  assert.equal(isHorseMediaStoragePath('a/b/c/d/e.jpg'), false);
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
