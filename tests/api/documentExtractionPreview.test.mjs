import assert from 'node:assert/strict';
import test from 'node:test';
import { renderRoute, nodes } from '../helpers/recordWorkflowHarness.mjs';

const document = {
  id: 'doc-preview',
  title: 'Source paper',
  type: 'Registration',
  state: 'Needs Review',
  uploadedBy: 'Fixture',
  uploadedAt: '',
  source: 'Bulk Intake',
  confidence: 0.9,
  duplicateRisk: 'Low',
  summary: '',
  entities: { horseName: 'STALE PROFILE NAME', color: 'Stale cached color' },
  extractedTextPreview: 'Certificate of Registration\nHorse Name: BLUE DOLLY\nRegistration Number: 1234567\nColor: Bay',
};
function text(node) {
  if (node == null || typeof node === 'boolean') return '';
  if (Array.isArray(node)) return node.map(text).join('');
  return typeof node === 'object' ? text(node.props?.children) : String(node);
}

test('review row offers fresh source details beside approval without trusting cached profile fields', async () => {
  const original = structuredClone(document);
  const f = await renderRoute('Documents', { documents: [document] }, 'stage=Review');
  const previews = nodes(f.tree, (n) => n.type === 'DocumentExtractionPreview');
  assert.equal(previews.length, 1);
  assert.equal(previews[0].props.document.entities.horseName, 'BLUE DOLLY');
  assert.notEqual(previews[0].props.document.entities.color, 'Stale cached color');
  assert.equal(previews[0].props.document.extractedTextPreview, document.extractedTextPreview);
  assert.deepEqual(document, original);
  assert.equal(f.calls.length, 0);
});

test('read-only source preview is collapsed and shows exact extracted details and text as text', async () => {
  const source = { ...document, entities: { horseName: '<b>BLUE DOLLY</b>', registrationNumber: '1234567' } };
  const f = await renderRoute('components/DocumentExtractionPreview', {}, '', {
    exportName: 'DocumentExtractionPreview',
    props: { document: source },
  });
  const disclosure = nodes(f.tree, (n) => n.type === 'details')[0];
  assert.ok(disclosure);
  assert.ok(!disclosure.props.open);
  assert.match(text(disclosure), /Horse name: <b>BLUE DOLLY<\/b>/);
  assert.match(text(disclosure), /Registration number: 1234567/);
  assert.match(text(disclosure), /Text preview/);
  assert.ok(text(disclosure).includes(document.extractedTextPreview));
  assert.equal(nodes(f.tree, (n) => n.props.dangerouslySetInnerHTML !== undefined).length, 0);
  assert.equal(nodes(f.tree, (n) => typeof n.props.onClick === 'function').length, 0);
  assert.equal(f.calls.length, 0);
});

test('empty extraction is explained without inventing fields, certainty, or changing the document', async () => {
  const source = { ...document, entities: {}, extractedTextPreview: '' };
  const original = structuredClone(source);
  const f = await renderRoute('components/DocumentExtractionPreview', {}, '', {
    exportName: 'DocumentExtractionPreview',
    props: { document: source },
  });
  assert.match(text(f.tree), /No structured details could be read/);
  assert.match(text(f.tree), /No text preview is available/);
  assert.doesNotMatch(text(f.tree), /90%|STALE PROFILE NAME/);
  assert.deepEqual(source, original);
});

test('legacy documents without OCR text still open the review screen safely', async () => {
  const source = { ...document, entities: {} };
  delete source.extractedTextPreview;
  const f = await renderRoute('components/DocumentExtractionPreview', {}, '', {
    exportName: 'DocumentExtractionPreview',
    props: { document: source },
  });
  assert.match(text(f.tree), /No text preview is available/);
  assert.equal(f.calls.length, 0);
});
