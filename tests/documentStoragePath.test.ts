import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDocumentStoragePath,
  documentFileExtension,
  explainUnopenableCloudDocument,
  isWorkspaceStorageKey,
  sanitizeDocumentPathSegment,
} from '../src/lib/documentStoragePath.js';

const workspaceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('a document is stored under the workspace, which is what makes it shared', () => {
  const path = buildDocumentStoragePath({
    workspaceId,
    horseId: 'horse-42',
    objectId: 'document-abc',
    originalFileName: 'coggins.pdf',
  });
  assert.equal(path, `${workspaceId}/documents/horse-42/document-abc.pdf`);
});

test('the first segment is the workspace id itself, because the policy compares it', () => {
  // The storage policy reads `split_part(name, '/', 1)` and checks it against
  // real membership. If this ever stops being exactly the workspace id, every
  // upload becomes a file the ranch cannot open.
  const path = buildDocumentStoragePath({
    workspaceId,
    horseId: 'horse-42',
    objectId: 'document-abc',
    originalFileName: 'coggins.pdf',
  });
  assert.ok(path);
  assert.equal(path.split('/')[0], workspaceId);
});

test('an uppercase workspace id is normalised, not silently mismatched', () => {
  // Postgres renders uuids lowercase; an uppercase one would be a real
  // workspace id that fails to match its own workspace.
  const path = buildDocumentStoragePath({
    workspaceId: workspaceId.toUpperCase(),
    objectId: 'document-abc',
    originalFileName: 'x.pdf',
  });
  assert.ok(path);
  assert.equal(path.split('/')[0], workspaceId);
});

test('no workspace means no upload, rather than a file nobody can open', () => {
  for (const missing of [null, undefined, '', '   ']) {
    assert.equal(
      buildDocumentStoragePath({
        workspaceId: missing,
        objectId: 'document-abc',
        originalFileName: 'x.pdf',
      }),
      null,
      `expected ${JSON.stringify(missing)} to be refused`,
    );
  }
});

test('a workspace id that is not a workspace id is refused, never repaired', () => {
  // Sanitising these would produce a different, valid-looking first segment:
  // an object filed under a namespace nobody owns, or the wrong one.
  for (const bad of [
    'not-a-uuid',
    '../../etc',
    `${workspaceId}/../other`,
    `${workspaceId} `,
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa', // one character short
    'zzzzzzzz-aaaa-4aaa-8aaa-aaaaaaaaaaaa', // not hex
  ]) {
    assert.equal(
      buildDocumentStoragePath({ workspaceId: bad, objectId: 'd', originalFileName: 'x.pdf' }),
      null,
      `expected ${bad} to be refused`,
    );
    assert.equal(isWorkspaceStorageKey(bad), false, `expected ${bad} to be rejected`);
  }
});

test('a crafted file name cannot add path segments', () => {
  // `'note.tar/../../x'.split('.').pop()` is `/../../x`: taken literally it
  // would inject segments into the object name.
  const path = buildDocumentStoragePath({
    workspaceId,
    horseId: 'horse/../../elsewhere',
    objectId: 'document/../../abc',
    originalFileName: 'note.tar/../../x',
  });
  assert.ok(path);
  assert.equal(path.split('/').length, 4);
  assert.equal(path.split('/')[0], workspaceId);
  assert.ok(!path.includes('..'));
});

test('the extension survives so the download opens in the right application', () => {
  assert.equal(documentFileExtension('scan.PDF'), 'pdf');
  assert.equal(documentFileExtension('archive.tar.gz'), 'gz');
  assert.equal(documentFileExtension('noextension'), 'bin');
  assert.equal(documentFileExtension('trailing.'), 'bin');
  assert.equal(documentFileExtension('x.thisextensionisabsurdlylong'), 'thisextensio');
});

test('a missing horse files the document rather than losing it', () => {
  assert.equal(
    buildDocumentStoragePath({ workspaceId, objectId: 'd', originalFileName: 'x.pdf' }),
    `${workspaceId}/documents/unassigned/d.pdf`,
  );
  assert.equal(
    buildDocumentStoragePath({ workspaceId, horseId: '///', objectId: 'd', originalFileName: 'x.pdf' }),
    `${workspaceId}/documents/unassigned/d.pdf`,
  );
});

test('segment sanitising keeps a fallback rather than emitting an empty segment', () => {
  assert.equal(sanitizeDocumentPathSegment('', 'unassigned'), 'unassigned');
  assert.equal(sanitizeDocumentPathSegment('---', 'unassigned'), 'unassigned');
  assert.equal(sanitizeDocumentPathSegment('Horse  #7', 'unassigned'), 'horse-7');
});

const viewerId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const uploaderId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

test('a teammate is told why an old document will not open for them', () => {
  const message = explainUnopenableCloudDocument({
    storagePath: `${uploaderId}/documents/horse-42/document-abc.pdf`,
    viewerUserId: viewerId,
    workspaceId,
  });
  assert.ok(message);
  assert.match(message, /uploaded it/);
  assert.match(message, /upload it again/);
});

test('nothing is invented about a document in this workspace', () => {
  // A workspace-keyed object that failed for some other reason -- a network
  // blip, an expired bucket -- must report what actually happened, not a story
  // about the old storage scheme.
  assert.equal(
    explainUnopenableCloudDocument({
      storagePath: `${workspaceId}/documents/horse-42/document-abc.pdf`,
      viewerUserId: viewerId,
      workspaceId,
    }),
    null,
  );
});

test('nothing is invented about the viewer own legacy upload', () => {
  assert.equal(
    explainUnopenableCloudDocument({
      storagePath: `${viewerId}/documents/horse-42/document-abc.pdf`,
      viewerUserId: viewerId,
      workspaceId,
    }),
    null,
  );
  assert.equal(
    explainUnopenableCloudDocument({
      storagePath: `${viewerId.toUpperCase()}/documents/horse-42/document-abc.pdf`,
      viewerUserId: viewerId,
      workspaceId,
    }),
    null,
  );
});

test('a path with no workspace-shaped namespace explains nothing', () => {
  for (const path of ['', 'documents/horse-42/x.pdf', 'not-a-uuid/documents/x.pdf']) {
    assert.equal(
      explainUnopenableCloudDocument({ storagePath: path, viewerUserId: viewerId, workspaceId }),
      null,
      `expected ${path} to explain nothing`,
    );
  }
});

test('an unresolved workspace still keeps the viewer own uploads out of the story', () => {
  // With no workspace loaded, the one thing we still know is the viewer's id.
  assert.equal(
    explainUnopenableCloudDocument({
      storagePath: `${viewerId}/documents/horse-42/x.pdf`,
      viewerUserId: viewerId,
      workspaceId: null,
    }),
    null,
  );
});

test('an unresolved workspace does not silence the explanation either', () => {
  // The signed URL already failed. Had this object belonged to a workspace the
  // viewer is in, membership would have granted it -- so a namespace that is
  // neither theirs nor their workspace's is still a teammate's old upload, and
  // saying nothing would leave them with the storage layer's own noise.
  const message = explainUnopenableCloudDocument({
    storagePath: `${uploaderId}/documents/horse-42/x.pdf`,
    viewerUserId: viewerId,
    workspaceId: null,
  });
  assert.ok(message);
  assert.match(message, /uploaded it/);
});
