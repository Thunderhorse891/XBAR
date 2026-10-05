import assert from 'node:assert/strict';
import test from 'node:test';
import { cloudBootstrapFixture as fixture } from './fixtures/cloudBootstrapHarness.mjs';

test('an edit whose debounce expires during a save is sent afterwards without another edit', async () => {
  const f = await fixture();
  await f.tick(1600);
  assert.equal(f.calls.length, 1);
  f.edit(2);
  await f.tick(1600);
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  await f.tick(1600);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].backup.workspace.value, 2);
  assert.notEqual(f.states.at(-1)[0], 'idle');
  f.dispose();
});

test('a returned failure retries without requiring an edit or online event', async () => {
  const f = await fixture();
  await f.tick(1600);
  f.calls[0].resolve({ ok: false, message: 'Unavailable' });
  await f.tick(0);
  await f.tick(30000);
  assert.equal(f.calls.length, 2);
  f.dispose();
});

test('a rejected save releases the queue and retries', async () => {
  const f = await fixture();
  await f.tick(1600);
  f.calls[0].reject(new Error('Transport failed'));
  await f.tick(0);
  await f.tick(30000);
  assert.equal(f.calls.length, 2);
  f.dispose();
});

test('success reports Saved only after the newest version is acknowledged', async () => {
  const f = await fixture();
  await f.tick(1600);
  f.edit(2);
  f.calls[0].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  assert.equal(f.states.at(-1)[0], 'syncing');
  await f.tick(1600);
  f.calls[1].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  assert.equal(f.states.at(-1)[0], 'idle');
  await f.tick(30000);
  assert.equal(f.calls.length, 2);
  f.dispose();
});

test('offline edits retry and online notification resumes without changing data', async () => {
  const f = await fixture();
  navigator.onLine = false;
  await f.tick(1600);
  assert.equal(f.calls.length, 0);
  navigator.onLine = true;
  f.listeners.online();
  await f.tick(1600);
  assert.equal(f.calls.length, 1);
  f.dispose();
});

test('a replaced workspace or account cannot receive late save status or another retry', async () => {
  for (const replacement of [
    { workspaceId: 'ranch-b' },
    { session: { user: { id: 'user-b' } } },
    { autosaveUnlocked: false },
  ]) {
    const f = await fixture();
    await f.tick(1600);
    Object.assign(f.cloud, replacement);
    const previous = f.states.length;
    f.calls[0].resolve({ ok: true, message: 'Wrong context saved' });
    await f.tick(0);
    await f.tick(30000);
    assert.equal(f.states.length, previous);
    assert.equal(f.calls.length, 1);
    f.dispose();
  }
});

test('disposal clears queued retries and ignores an in-flight completion', async () => {
  const f = await fixture();
  await f.tick(1600);
  f.edit(2);
  f.dispose();
  const previous = f.states.length;
  f.calls[0].resolve({ ok: false, message: 'Unavailable' });
  await f.tick(30000);
  assert.equal(f.calls.length, 1);
  assert.equal(f.states.length, previous);
});

test('snapshot exceptions do not escape the retry queue', async () => {
  const f = await fixture();
  const value = {};
  value.self = value;
  f.backup = value;
  await f.tick(1600);
  assert.equal(f.calls.length, 0);
  assert.equal(f.states.at(-1)[0], 'error');
  f.backup = { workspace: { value: 2 } };
  await f.tick(30000);
  assert.equal(f.calls.length, 1);
  f.dispose();
});

test('a failed post-save snapshot inspection remains retryable rather than stranding error status', async () => {
  const f = await fixture();
  await f.tick(1600);
  assert.deepEqual(f.calls[0].options.expectedContext, { userId: 'user-a', workspaceId: 'ranch-a' });
  const value = {};
  value.self = value;
  f.backup = value;
  f.calls[0].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  assert.equal(f.states.at(-1)[0], 'error');
  f.backup = { workspace: { value: 1 } };
  await f.tick(30000);
  assert.equal(f.calls.length, 2);
  f.calls[1].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  assert.equal(f.states.at(-1)[0], 'idle');
  f.dispose();
});

test('clean focus refresh installs teammate records without echo-saving them', async () => {
  const f = await fixture();
  await f.tick(1600);
  f.calls[0].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  const stop = f.startRefresh();
  f.listeners.focus();
  await f.tick(0);
  assert.equal(f.loads.length, 1);
  f.loads[0]({ ok: true, source: 'relational', workspaceId: 'ranch-a', backup: { workspace: { value: 2 } } });
  await f.tick(0);
  await f.tick(1600);
  assert.equal(f.backup.workspace.value, 2);
  assert.equal(f.calls.length, 1);
  stop();
  f.dispose();
});

test('focus refresh cannot replace an edit made while the remote read is pending', async () => {
  const f = await fixture();
  await f.tick(1600);
  f.calls[0].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  const stop = f.startRefresh();
  f.listeners.focus();
  await f.tick(0);
  f.edit(3);
  f.loads[0]({ ok: true, source: 'relational', workspaceId: 'ranch-a', backup: { workspace: { value: 2 } } });
  await f.tick(0);
  assert.equal(f.backup.workspace.value, 3);
  stop();
  f.dispose();
});

test('focus refresh is read-only on failure and refuses replaced workspace context', async () => {
  for (const changed of [false, true]) {
    const f = await fixture();
    await f.tick(1600);
    f.calls[0].resolve({ ok: true, message: 'Saved' });
    await f.tick(0);
    const stop = f.startRefresh();
    f.listeners.focus();
    await f.tick(0);
    if (changed) f.cloud.workspaceId = 'other';
    f.loads[0](
      changed
        ? { ok: true, source: 'relational', workspaceId: 'ranch-a', backup: { workspace: { value: 2 } } }
        : { ok: false, message: 'Incomplete cloud load' },
    );
    await f.tick(0);
    assert.equal(f.backup.workspace.value, 1);
    stop();
    f.dispose();
  }
});

test('a workspace or role round trip invalidates an in-flight refresh', async () => {
  for (const key of ['workspaceId', 'workspaceRole']) {
    const f = await fixture();
    await f.tick(1600);
    f.calls[0].resolve({ ok: true, message: 'Saved' });
    await f.tick(0);
    const stop = f.startRefresh();
    f.listeners.focus();
    await f.tick(0);
    const original = { ...f.cloud };
    f.cloud[key] = 'other';
    f.cloudChange(f.cloud, original);
    const interim = { ...f.cloud };
    f.cloud[key] = original[key];
    f.cloudChange(f.cloud, interim);
    f.loads[0]({ ok: true, source: 'relational', workspaceId: 'ranch-a', backup: { workspace: { value: 2 } } });
    await f.tick(0);
    assert.equal(f.backup.workspace.value, 1);
    stop();
    f.dispose();
  }
});

test('a throwing snapshot on focus refresh is handled and a later focus can recover', async () => {
  const f = await fixture();
  await f.tick(1600);
  f.calls[0].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  const stop = f.startRefresh();
  const circular = {};
  circular.self = circular;
  f.backup = circular;
  f.listeners.focus();
  await f.tick(0);
  assert.equal(f.loads.length, 0);
  f.backup = { workspace: { value: 1 } };
  f.listeners.focus();
  await f.tick(0);
  assert.equal(f.loads.length, 1);
  stop();
  f.dispose();
});

test('normalized empty remote histories cannot erase this workspace’s local packet references', async () => {
  const f = await fixture();
  f.backup.workspace.auditEvents = [{ id: 'audit-a' }];
  f.backup.workspace.salePacketBuilds = [{ id: 'packet-a', localFileKey: 'file-a' }];
  f.backup.workspace.buyerRoomEvents = [{ id: 'buyer-a' }];
  await f.tick(1600);
  f.calls[0].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  const stop = f.startRefresh();
  f.listeners.focus();
  await f.tick(0);
  f.loads[0]({
    ok: true,
    source: 'relational',
    workspaceId: 'ranch-a',
    backup: { workspace: { value: 2, auditEvents: [], salePacketBuilds: [], buyerRoomEvents: [] } },
  });
  await f.tick(0);
  assert.equal(f.backup.workspace.value, 2);
  assert.deepEqual(f.backup.workspace.salePacketBuilds, [{ id: 'packet-a', localFileKey: 'file-a' }]);
  assert.equal(f.backup.workspace.auditEvents.length, 1);
  assert.equal(f.backup.workspace.buyerRoomEvents.length, 1);
  stop();
  f.dispose();
});

test('live refresh never installs a successful but stale device recovery snapshot', async () => {
  const f = await fixture();
  await f.tick(1600);
  f.calls[0].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  const stop = f.startRefresh();
  f.listeners.focus();
  await f.tick(0);
  f.loads[0]({ ok: true, source: 'snapshot', backup: { workspace: { value: 99 } } });
  await f.tick(0);
  assert.equal(f.backup.workspace.value, 1);
  stop();
  f.dispose();
});

test('live refresh refuses a relational response for a different ranch', async () => {
  const f = await fixture();
  await f.tick(1600);
  f.calls[0].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  const stop = f.startRefresh();
  f.listeners.focus();
  await f.tick(0);
  f.loads[0]({ ok: true, source: 'relational', workspaceId: 'other-ranch', backup: { workspace: { value: 99 } } });
  await f.tick(0);
  assert.equal(f.backup.workspace.value, 1);
  stop();
  f.dispose();
});

test('healthy snapshot-only sessions do not schedule unsupported live refresh or warnings', async () => {
  const f = await fixture();
  f.relational = false;
  await f.tick(1600);
  f.calls[0].resolve({ ok: true, message: 'Saved' });
  await f.tick(0);
  const stop = f.startRefresh();
  assert.equal(f.listeners.focus, undefined);
  assert.equal(stop, undefined);
  assert.equal(f.loads.length, 0);
  f.dispose();
});
