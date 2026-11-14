import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { recoveryCanCancel } from '../../src/lib/reservedUploadClient.ts';

test('cancel is only available for confirmed incomplete uploads before any completion attempt', () => {
  assert.equal(recoveryCanCancel({ state: 'uploading', serverStatus: 'uploading' }), true);
  assert.equal(recoveryCanCancel({ state: 'prepared', serverStatus: 'reserved' }), true);
  for (const state of ['prepared', 'completing', 'completed', 'aborted', 'pending', 'not_started'])
    assert.equal(recoveryCanCancel({ state, serverStatus: 'uploading' }), false);
  for (const status of ['reconcile', 'completing', 'completed', 'aborting', 'aborted', undefined])
    assert.equal(recoveryCanCancel({ state: 'uploading', serverStatus: status }), false);
  assert.equal(recoveryCanCancel({ state: 'uploading', serverStatus: 'uploading', completionStarted: true }), false);
});
test('Settings adds bounded recovery without replacing existing settings or touching heroes', () => {
  const settings = readFileSync('src/routes/Settings.tsx', 'utf8');
  assert.equal(settings.match(/<UploadRecoveryPanel \/>/g)?.length, 1);
  assert(settings.includes('Delete account'));
  assert(settings.includes('Export backup'));
  const ui = readFileSync('src/components/UploadRecoveryPanel.tsx', 'utf8');
  assert.match(ui, /listReservedUploadRecovery\(target\)/);
  assert.match(ui, /Check status/);
  assert.match(ui, /recoveryCanCancel\(record\)/);
  assert.match(ui, /<ConfirmActionDialog/);
  assert.match(ui, /never removes a completed original/);
  assert.match(ui, /No record was linked automatically/);
  assert.match(ui, /Show confirmed uploads/);
  assert.match(ui, /missing from its record/);
  assert.match(ui, /support must reconcile/);
  assert.match(ui, /key=\{`\$\{userId\}:\$\{workspaceId\}`\}/);
  assert.doesNotMatch(ui, /resumeReservedUpload|\.remove\(|\.delete\(|\.upload\(/);
});

test('upload recovery wraps full filenames, storage paths, IDs and status notices within its own panel', () => {
  const ui = readFileSync('src/components/UploadRecoveryPanel.tsx', 'utf8');
  // Edge at 390px reproduced scrollWidth 758px from the text of a long path,
  // even though the paragraph's element bounding box stayed inside the panel.
  // The parent style is inherited by both notices and record content and does
  // not alter global text wrapping, heroes, artwork or other Settings panels.
  assert.match(ui, /<Panel\s+style=\{\{ minWidth: 0, overflowWrap: 'anywhere' \}\}/);
  assert.match(ui, /Storage path: \{record\.storagePath\}/);
  assert.match(ui, /Recovery ID: \{record\.requestId\}/);
  assert.match(ui, /\{record\.fileName\}/);
  assert.doesNotMatch(
    ui,
    /overflow:\s*['"]hidden['"]|textOverflow:\s*['"]ellipsis['"]/,
    'recovery identifiers must stay fully readable, not clipped to hide the overflow',
  );
});
