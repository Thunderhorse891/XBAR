import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const profile = readFileSync('src/routes/AnimalProfile.tsx', 'utf8');
assert.doesNotMatch(
  profile,
  /<input\s+ref=\{photoInputRef\}[\s\S]*?capture="environment"/,
  'The shared Add/Replace Photo entry must not force a camera capture.',
);
console.log('Media source regression passed.');

// Test the picker contract independently of device-specific sheet presentation.
const { photoSources, takePhotoSelection } = await import('../src/lib/photoSelection.js');
assert.deepEqual(
  photoSources.map(({ label }) => label),
  ['Photo library', 'Camera', 'Files'],
);
for (const source of photoSources) {
  assert.equal('capture' in source ? source.capture : undefined, source.id === 'camera' ? 'environment' : undefined);
  assert.equal(source.multiple, source.id !== 'camera');
}
assert.equal(photoSources[0].accept, 'image/*');
for (const extension of ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif']) {
  assert.ok(photoSources[2].accept.split(',').includes(extension), `${extension} should be selectable from Files`);
}
const first = new File(['first'], 'horse.jpg', { type: 'image/jpeg' });
const second = new File(['second'], 'horse.heic', { type: 'image/heic' });
const noMime = new File(['third'], 'HORSE.PNG');
const input = { files: [first, second, noMime], value: 'C:\\fakepath\\horse.jpg' };
assert.deepEqual(takePhotoSelection(input), [first, second, noMime], 'Pass every selected file through unchanged');
assert.equal(input.value, '', 'Reset the input so the same selection can be retried');
input.value = 'C:\\fakepath\\horse.jpg';
assert.deepEqual(takePhotoSelection(input), [first, second, noMime], 'Reselection does not discard a repeated file');
assert.deepEqual(takePhotoSelection({ files: [], value: '' }), [], 'Cancel does not produce a photo');
assert.deepEqual(takePhotoSelection({ files: null, value: '' }), [], 'A missing FileList is cancellation');
const picker = readFileSync('src/components/HorsePhotoSourceDialog.tsx', 'utf8');
assert.match(picker, /if \(!files\.length\) return;/, 'Cancellation must not upload');
assert.match(picker, /onCloseAutoFocus/, 'Closing the dialog must return keyboard focus');
assert.match(profile, /onClick=\{openPhotoSource\}/, 'Add and replace buttons open the same chooser');
assert.match(
  profile,
  /onAddPhoto=\{canUploadMedia \? openPhotoSource : undefined\}/,
  'Readiness uses the same chooser',
);
assert.match(profile, /!canUploadMedia \|\| photoUploadPending\.current/, 'Do not start a second concurrent upload');
console.log('Photo picker sources, cancellation, formats and reselection passed.');

assert.match(profile, /useHorsePhotoSelection/, 'Native results must be scoped to the originating record and session');
assert.doesNotMatch(
  profile,
  /horseId: animal\.id,\s*files,/,
  'Delayed picker results must not upload to the current rendered horse',
);

const { createPhotoSelectionGate } = await import('../src/lib/photoSelection.js');
const scope = {
  horseId: 'horse-a',
  routeKey: 'route-a',
  routeUrl: 'https://xbar.test/horses/horse-a',
  accountId: 'account-a',
  workspaceId: 'workspace-a',
  role: 'Admin',
  workspaceRecord: {},
  horseRecord: {},
};
for (const change of [
  { horseId: 'horse-b' },
  { routeKey: 'route-b' },
  { routeUrl: 'https://xbar.test/horses/horse-b' },
  { accountId: 'account-b' },
  { workspaceId: 'workspace-b' },
  { role: 'Viewer' },
  { workspaceRecord: {} },
  { horseRecord: {} },
]) {
  const gate = createPhotoSelectionGate();
  const original = gate.open(scope);
  assert.equal(gate.consume(original, { ...scope, ...change }), null, `Refuse changed scope ${Object.keys(change)}`);
  const beforeAba = gate.open(scope);
  assert.equal(gate.reconcile({ ...scope, ...change }), true, 'Observe each synchronous scope change');
  assert.equal(gate.reconcile(scope), false, 'Returning to the old scope must not restore the ticket');
  assert.equal(gate.consume(beforeAba, scope), null, 'Refuse ABA result from the old native picker');
}
const gate = createPhotoSelectionGate();
const unmounted = gate.open(scope);
gate.invalidate();
assert.equal(gate.consume(unmounted, scope), null, 'Unmount/Cancel revokes even a retained callback');
const superseded = gate.open(scope);
const latest = gate.open(scope);
assert.equal(gate.consume(superseded, scope), null, 'Old callbacks cannot consume a newer picker request');
assert.equal(gate.consume(latest, scope), 'horse-a', 'A current request pins the originating horse');
assert.equal(gate.consume(latest, scope), null, 'A FileList callback can be consumed only once');
const absent = gate.open(scope);
assert.equal(gate.consume(absent, null), null, 'A removed horse or permission loss fails closed');
const hook = readFileSync('src/hooks/useHorsePhotoSelection.ts', 'utf8');
assert.match(hook, /useXbarStore\.subscribe\(reconcile\)/, 'Local reset/role changes must invalidate synchronously');
assert.match(hook, /useCloudStore\.subscribe\(reconcile\)/, 'Cloud identity changes must invalidate synchronously');
assert.match(hook, /window\.location\.href/, 'Compare live navigation before React commits');
assert.match(hook, /window\.addEventListener\('popstate', cancel\)/, 'History changes revoke the original ticket');
assert.match(profile, /horseId: targetHorseId/, 'Only the consumed originating ID may reach the uploader');
console.log('Photo-selection scope, ABA, unmount and one-shot regression assertions passed.');
