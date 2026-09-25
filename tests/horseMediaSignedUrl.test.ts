import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { primaryHorseMedia } from '../src/lib/horseMedia.js';
import type { GalleryAsset } from '../src/types/xbar.js';

/*
 * horse-media is a PRIVATE bucket: every render must resolve a signed URL
 * from the asset's storagePath instead of using a permanent public URL.
 * primaryHorseMedia is the single place that pairs a horse's display image
 * with the storage path the signed-URL flow needs; these tests pin its
 * contract, and the static tests below prove no public-URL code path remains
 * for horse media anywhere in src/.
 */

function asset(overrides: Partial<GalleryAsset>): GalleryAsset {
  return {
    id: 'media-1',
    label: 'Photo',
    kind: 'Hero',
    url: '',
    status: 'Approved',
    ...overrides,
  };
}

const STORAGE_PATH = 'uploader-uuid-1/horses/horse-abc/media-uuid-9.jpg';

test('a profileImage promoted from the gallery resolves to that asset storagePath', () => {
  const gallery = [
    asset({ id: 'media-1', url: 'https://old-public-url/photo.jpg', storagePath: STORAGE_PATH }),
    asset({ id: 'media-2', url: 'https://old-public-url/other.jpg' }),
  ];
  const primary = primaryHorseMedia({ profileImage: 'https://old-public-url/photo.jpg', gallery });
  assert.equal(primary.src, 'https://old-public-url/photo.jpg');
  assert.equal(primary.storagePath, STORAGE_PATH);
});

test('a legacy profileImage with no matching gallery asset keeps its src and no storagePath', () => {
  // Old public URLs from before the bucket went private: they render exactly
  // as before (dead link shows the fallback tile) and must NOT be paired with
  // some other asset's storagePath, which would show the wrong photo.
  const gallery = [asset({ id: 'media-1', url: 'https://cdn/x.jpg', storagePath: STORAGE_PATH })];
  const primary = primaryHorseMedia({ profileImage: 'https://external-cdn/portrait.jpg', gallery });
  assert.equal(primary.src, 'https://external-cdn/portrait.jpg');
  assert.equal(primary.storagePath, null);
});

test('without a profileImage the first gallery asset is primary', () => {
  const gallery = [
    asset({ id: 'media-1', url: '', storagePath: STORAGE_PATH }),
    asset({ id: 'media-2', url: '', storagePath: 'uploader-uuid-1/horses/horse-abc/media-uuid-10.jpg' }),
  ];
  const primary = primaryHorseMedia({ profileImage: '', gallery });
  assert.equal(primary.storagePath, STORAGE_PATH);
});

test('an empty gallery yields no src and no storagePath', () => {
  const primary = primaryHorseMedia({ profileImage: '', gallery: [] });
  assert.equal(primary.src, null);
  assert.equal(primary.storagePath, null);
});

test('the fallback picker chooses when there is no profileImage', () => {
  const hero = asset({ id: 'media-hero', kind: 'Hero', storagePath: STORAGE_PATH });
  const other = asset({ id: 'media-other', kind: 'Document Cover', storagePath: 'other/path.jpg' });
  const primary = primaryHorseMedia({ profileImage: '', gallery: [other, hero] }, (gallery) =>
    gallery.find((candidate) => candidate.kind === 'Hero'),
  );
  assert.equal(primary.storagePath, STORAGE_PATH);
});

test('a set profileImage wins over the fallback picker', () => {
  const gallery = [asset({ id: 'media-1', url: 'https://cdn/a.jpg', storagePath: STORAGE_PATH })];
  const primary = primaryHorseMedia({ profileImage: 'https://cdn/a.jpg', gallery }, () => undefined);
  assert.equal(primary.src, 'https://cdn/a.jpg');
  assert.equal(primary.storagePath, STORAGE_PATH);
});

const repoRoot = process.cwd();
const srcDir = path.join(repoRoot, 'src');

function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      return tsFilesUnder(full);
    }
    return full.endsWith('.ts') || full.endsWith('.tsx') ? [full] : [];
  });
}

test('no public media URLs are minted anywhere in src/', () => {
  // getPublicUrl on the horse-media bucket was the finding: permanent,
  // unauthenticated URLs for every horse photo. The signed-URL path replaced
  // it; this fails if any call site comes back.
  const offenders = tsFilesUnder(srcDir).filter((file) => readFileSync(file, 'utf8').includes('getPublicUrl'));
  assert.deepEqual(offenders, []);
});

test('the media upload path signs instead of publishing', () => {
  const source = readFileSync(path.join(srcDir, 'lib', 'cloudWorkspace.ts'), 'utf8');
  assert.match(source, /createSignedUrl/);
  assert.ok(!source.includes('getPublicUrl'));
});
