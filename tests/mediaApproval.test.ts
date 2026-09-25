import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { GalleryAsset } from '../src/types/xbar.js';

test('new uploads do not self-approve', () => {
  const source = readFileSync('src/store/useXbarStore.ts', 'utf8');
  const upload = source.slice(
    source.indexOf('uploadHorseMedia: async'),
    source.indexOf('uploadHorseMedia: async') + 4000,
  );
  assert.match(upload, /status: 'Pending' as const/);
  assert.doesNotMatch(upload, /status: 'Approved'/);
});

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
