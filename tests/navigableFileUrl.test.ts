import assert from 'node:assert/strict';
import test from 'node:test';

import { isNavigableFileUrl } from '../src/lib/navigableFileUrl.js';

/*
 * A document's `fileUrl` is workspace data, and workspace data arrives in
 * imported backups — a file the rancher was handed by someone else.
 *
 * `openStoredFile` assigns it to `previewWindow.location.href`, where
 * `previewWindow` is an `about:blank` this app opened and therefore
 * same-origin. A `javascript:` URL there runs with this app's origin and reads
 * localStorage and IndexedDB: the workspace, the session, and every document in
 * the vault. Clearing `opener` does not help — the blank document inherited the
 * origin when it was opened, before any URL was assigned.
 */

/** A window.location, because relative URLs resolve against one. */
function withOrigin(href: string | null) {
  const previous = (globalThis as { window?: unknown }).window;
  if (href === null) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window?: unknown }).window = { location: { href } };
  return () => {
    if (previous === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = previous;
  };
}

test('a scripting URL is refused however it is spelled', () => {
  const restore = withOrigin('https://app.example.com/documents');
  try {
    for (const hostile of [
      'javascript:alert(1)',
      // Case and whitespace, every one of which a startsWith check misses and
      // the browser still executes.
      'JaVaScRiPt:alert(1)',
      '  javascript:alert(1)',
      '\njavascript:alert(1)',
      'java\tscript:alert(1)',
      'JAVASCRIPT:fetch("//x/"+localStorage.getItem("xbar-live-workspace"))',
      'vbscript:msgbox(1)',
      // Not a script, but a document with an opaque origin that has no business
      // being navigated to from a record.
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
    ]) {
      assert.equal(isNavigableFileUrl(hostile), false, `${JSON.stringify(hostile)} must not be navigable`);
    }
  } finally {
    restore();
  }
});

test('the URLs real documents actually use are allowed', () => {
  /*
   * Over-rejection here breaks every document in the app, which is a worse
   * outcome than the hole being closed — so each allowed scheme is pinned to
   * the thing that produces it.
   */
  const restore = withOrigin('https://app.example.com/documents');
  try {
    // Supabase storage, and the same on a local stack.
    assert.equal(isNavigableFileUrl('https://project.supabase.co/storage/v1/object/sign/docs/coggins.pdf'), true);
    assert.equal(isNavigableFileUrl('http://127.0.0.1:54321/storage/v1/object/docs/coggins.pdf'), true);
    // Every on-device file: the vault hands out URL.createObjectURL.
    assert.equal(isNavigableFileUrl('blob:https://app.example.com/6f1d-4c2a'), true);
    // A relative path resolves against this app's origin, as the browser would.
    assert.equal(isNavigableFileUrl('/uploads/coggins.pdf'), true);
  } finally {
    restore();
  }
});

test('an empty or unparseable value is not navigable', () => {
  const restore = withOrigin('https://app.example.com/documents');
  try {
    for (const value of ['', '   ', null, undefined, 42, {}, [], 'http://']) {
      assert.equal(isNavigableFileUrl(value), false, `${String(value)} must not be navigable`);
    }
  } finally {
    restore();
  }
});

test('with no browser origin, only absolute URLs resolve', () => {
  // Server-side rendering and the test runner. Nothing navigates there, so a
  // relative URL has nothing to resolve against and refusing is the honest
  // answer; an absolute one is still judged on its scheme.
  const restore = withOrigin(null);
  try {
    assert.equal(isNavigableFileUrl('/uploads/coggins.pdf'), false);
    assert.equal(isNavigableFileUrl('https://project.supabase.co/storage/v1/object/docs/x.pdf'), true);
    assert.equal(isNavigableFileUrl('javascript:alert(1)'), false);
  } finally {
    restore();
  }
});
