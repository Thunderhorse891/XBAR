import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { buildFacebookShareDialogUrl, buildPublicShareUrl } from '../src/lib/facebookSharing.js';

test('buildPublicShareUrl creates hash route links', () => {
  assert.equal(buildPublicShareUrl('/profiles/horse-wiggy'), '#/profiles/horse-wiggy');
});

test('buildPublicShareUrl appends share token when present', () => {
  assert.equal(buildPublicShareUrl('/profiles/horse-wiggy', 'token-123'), '#/profiles/horse-wiggy?t=token-123');
});

test('buildFacebookShareDialogUrl returns null without app configuration', () => {
  assert.equal(buildFacebookShareDialogUrl('/profiles/horse-wiggy'), null);
});

/*
 * The share dialog's own feature string decides whether its result means
 * anything. `noopener` and `noreferrer` both make window.open return null by
 * spec even when the window opens — confirmed directly in Chromium — so while
 * either was present, openFacebookShareDialog could only ever return
 * `ok: false`: it told every customer to allow pop-ups, including the ones
 * looking at the open dialog, and popup.focus() was unreachable.
 *
 * That branch cannot be exercised from this suite (facebookConfig reads
 * import.meta.env at module load, which is empty under node, so the function
 * short-circuits before opening anything). The invariant is a property of the
 * call itself, so it is asserted against the source: reintroducing either token
 * silently breaks the result, and nothing else in the suite would notice.
 */
test('the Facebook share window is opened with a readable result', async () => {
  // Resolved from the repo root, not import.meta.url: this file is compiled
  // into .codex-test-dist before it runs, so a relative URL points at the
  // build output rather than the source. Same approach as marketingSite.test.
  const source = await readFile(path.join(process.cwd(), 'src/lib/facebookSharing.ts'), 'utf8');
  const openCall = source.match(/window\.open\((?:.|\n)*?\);/)?.[0];

  assert.ok(openCall, 'expected a window.open call in facebookSharing.ts');
  assert.doesNotMatch(openCall, /noopener/, 'noopener makes window.open return null, so the popup check cannot pass');
  assert.doesNotMatch(openCall, /noreferrer/, 'noreferrer implies noopener, with the same effect on the return value');

  // Dropping those tokens is only safe because the opener is severed by hand;
  // without this the change would trade a broken message for reverse-tabnabbing.
  assert.match(source, /popup\.opener = null/);
});
