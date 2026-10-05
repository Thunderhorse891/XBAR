import assert from 'node:assert/strict';
import test from 'node:test';
import { renderRoute, nodes, action } from '../helpers/recordWorkflowHarness.mjs';

test('horse Documents passes actual linked originals to the existing library even with no extracted facts', async () => {
  const doc = (id, horseId) => ({
    id,
    title: id,
    horseId,
    type: 'Other',
    state: 'Needs Review',
    summary: '',
    extractedTextPreview: '',
    entities: {},
    localFileKey: id,
  });
  const f = await renderRoute('components/HorseDocuments', {
    documents: [
      doc('linked', 'horse-context'),
      doc('wrong', 'another-horse'),
      doc('legacy', undefined),
      doc('unassigned', undefined),
    ],
  });
  f.state.horses = [{ ...f.state.horses[0], documents: ['legacy', 'wrong'], documentFacts: [] }];
  f.render();
  const library = nodes(f.tree, (n) => n.type === 'DocumentLibrary')[0];
  assert.deepEqual(
    library.props.documents.map((x) => x.id),
    ['linked', 'legacy'],
  );
  assert.equal(typeof library.props.onDownload, 'function');
  assert.equal(typeof library.props.onOpen, 'function');
  library.props.onReview(library.props.documents[0]);
  assert.deepEqual(f.calls, [['navigate', '/documents?horse=horse-context&from=profile&stage=Review']]);
});
test('horse Documents upload uses the current horse and Upload stage', async () => {
  const f = await renderRoute('components/HorseDocuments');
  const upload = nodes(f.tree, (n) => n.type === 'ActionButton')[0];
  upload.props.onClick();
  assert.deepEqual(f.calls, [['navigate', '/documents?horse=horse-context&from=profile&upload=1']]);
});
test('gallery exposes all active photos and requires confirmation before recoverable removal', async () => {
  const f = await renderRoute('components/HorsePhotoGallery');
  f.state.horses = [
    {
      ...f.state.horses[0],
      gallery: [
        { id: 'a', label: 'First', kind: 'Conformation', status: 'Approved', url: 'https://example.test/a.jpg' },
        { id: 'b', label: 'Second', kind: 'Sale Still', status: 'Pending', url: 'https://example.test/b.jpg' },
      ],
    },
  ];
  f.state.changeHorsePhoto = (...args) => {
    f.calls.push(args);
    return { ok: true, message: 'Updated' };
  };
  f.render();
  assert.equal(nodes(f.tree, (n) => n.props['aria-label']?.startsWith('View ')).length, 2);
  action(f, 'Remove photo');
  f.render();
  assert.equal(f.calls.length, 0);
  const confirm = nodes(f.tree, (n) => n.type === 'ConfirmActionDialog')[0];
  assert.equal(confirm.props.open, true);
  confirm.props.onConfirm();
  assert.deepEqual(f.calls[0], ['horse-context', 'a', 'remove']);
});
test('a replaced horse while confirmation is open cannot remove a different photo record', async () => {
  const f = await renderRoute('components/HorsePhotoGallery');
  f.state.horses = [
    {
      ...f.state.horses[0],
      gallery: [
        { id: 'a', label: 'First', kind: 'Conformation', status: 'Approved', url: 'https://example.test/a.jpg' },
      ],
    },
  ];
  f.state.changeHorsePhoto = (...args) => {
    f.calls.push(args);
    return { ok: true, message: 'Updated' };
  };
  f.render();
  action(f, 'Remove photo');
  f.render();
  f.state.horses = [{ ...f.state.horses[0], name: 'Different record' }];
  f.render();
  nodes(f.tree, (n) => n.type === 'ConfirmActionDialog')[0].props.onConfirm();
  assert.equal(
    f.calls.some((x) => x[2] === 'remove'),
    false,
  );
  assert.equal(f.calls[0][0], 'toast');
});

test('cancelling photo removal closes confirmation without changing any record', async () => {
  const f = await renderRoute('components/HorsePhotoGallery');
  f.state.horses = [
    {
      ...f.state.horses[0],
      gallery: [
        { id: 'a', label: 'First', kind: 'Conformation', status: 'Approved', url: 'https://example.test/a.jpg' },
      ],
    },
  ];
  f.state.changeHorsePhoto = (...args) => {
    f.calls.push(args);
    return { ok: true, message: 'Updated' };
  };
  f.render();
  action(f, 'Remove photo');
  f.render();
  nodes(f.tree, (n) => n.type === 'ConfirmActionDialog')[0].props.onCancel();
  f.render();
  assert.equal(nodes(f.tree, (n) => n.type === 'ConfirmActionDialog')[0].props.open, false);
  assert.equal(f.calls.length, 0);
});

test('documents already belonging to a different ranch cannot start a download under the new ranch', async () => {
  const f = await renderRoute('components/HorseDocuments', {
    documents: [
      {
        id: 'doc',
        title: 'Original',
        horseId: 'horse-context',
        type: 'Other',
        state: 'Needs Review',
        summary: '',
        extractedTextPreview: '',
        entities: {},
        fileUrl: 'https://example.test/old.pdf',
      },
    ],
  });
  f.cloud = {
    workspaceId: 'ranch-b',
    workspaceRole: 'Admin',
    session: { user: { id: 'account-b' } },
    workspaceReady: true,
    autosaveReady: true,
  };
  const prior = globalThis.window;
  globalThis.window = { localStorage: { getItem: () => 'ranch-a' } };
  try {
    nodes(f.tree, (n) => n.type === 'DocumentLibrary')[0].props.onDownload(
      nodes(f.tree, (n) => n.type === 'DocumentLibrary')[0].props.documents[0],
    );
    await new Promise((done) => setImmediate(done));
    assert.equal(f.calls[0][0], 'toast');
    assert.equal(f.calls[0][1].title, 'Ranch still loading');
  } finally {
    globalThis.window = prior;
  }
});
