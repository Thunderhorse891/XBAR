import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { sha256, sha256Bytes } from '../src/lib/sha256.js';

// FIPS 180-4 / NIST standard SHA-256 test vectors.
test('matches the empty-string vector', () => {
  assert.equal(sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('matches the "abc" vector', () => {
  assert.equal(sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('matches the 448-bit two-block vector', () => {
  assert.equal(
    sha256('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  );
});

test('agrees with Node crypto across varied lengths and block boundaries', () => {
  // Lengths chosen to straddle the 55/56/64-byte padding edges where a naive
  // implementation would append the length word into the wrong block.
  for (const len of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128, 200]) {
    const input = 'x'.repeat(len);
    const expected = createHash('sha256').update(input).digest('hex');
    assert.equal(sha256(input), expected, `length ${len}`);
  }
});

test('hashes UTF-8 multibyte content the same as Node crypto', () => {
  const input = 'Río Bravo — ✓ 馬 🐎';
  const expected = createHash('sha256').update(input, 'utf8').digest('hex');
  assert.equal(sha256(input), expected);
});

test('sha256Bytes and sha256 agree on the same bytes', () => {
  const bytes = new TextEncoder().encode('abc');
  assert.equal(sha256Bytes(bytes), sha256('abc'));
});
