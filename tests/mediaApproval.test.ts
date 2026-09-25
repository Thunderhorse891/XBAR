import test from 'node:test';
import assert from 'node:assert/strict';
import type { GalleryAsset } from '../src/types/xbar.js';

test('explicit sale review requires a sales capability and usable media; preserves other assets', async () => {
  const { reviewMedia } = await import('../src/lib/mediaApproval.js');
  const gallery: GalleryAsset[] = [
    { id: 'a', label: 'Horse', kind: 'Hero', url: 'https://example.invalid/horse.jpg', status: 'Pending' },
  ];
  for (const role of ['Owner', 'Ranch Manager', 'Medical Lead'] as const)
    assert.equal(reviewMedia(gallery, 'a', role, true).ok, false);
  const approved = reviewMedia(gallery, 'a', 'Sales Lead', true);
  assert.equal(approved.ok, true);
  assert.equal(approved.gallery?.[0].status, 'Approved');
  assert.equal(gallery[0].status, 'Pending');
  assert.equal(reviewMedia(gallery, 'missing', 'Admin', true).ok, false);
  assert.equal(reviewMedia([{ ...gallery[0], url: '' }], 'a', 'Admin', true).ok, false);
  assert.equal(reviewMedia(approved.gallery!, 'a', 'Admin', false).gallery?.[0].status, 'Pending');
});

test('shared review requires matching server acknowledgement and preserves error outcomes', async () => {
  const { persistMediaReview } = await import('../src/lib/mediaReviewRequest.js');
  const input = {
    apiBase: '',
    accessToken: 'fixture',
    workspaceId: 'ranch',
    horseId: 'horse',
    assetId: 'photo',
    approved: true,
    expectedStoragePath: 'stored/photo',
    expectedUrl: '',
  };
  const original = globalThis.fetch;
  try {
    for (const status of [401, 403, 409, 503]) {
      globalThis.fetch = async () => new Response(JSON.stringify({ ok: false, message: 'Not saved' }), { status });
      assert.equal((await persistMediaReview(input)).ok, false);
    }
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true, ...input, assetId: 'wrong', status: 'Approved' }));
    assert.equal((await persistMediaReview(input)).ok, false);
    globalThis.fetch = async (url, init) => {
      assert.equal(url, '/api/account/media-review');
      assert.equal(init?.method, 'POST');
      assert.equal(JSON.parse(String(init?.body)).expectedStoragePath, input.expectedStoragePath);
      return new Response(
        JSON.stringify({
          ok: true,
          workspaceId: input.workspaceId,
          horseId: input.horseId,
          assetId: input.assetId,
          status: 'Approved',
        }),
      );
    };
    assert.equal((await persistMediaReview(input)).ok, true);
  } finally {
    globalThis.fetch = original;
  }
});
