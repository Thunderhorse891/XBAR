import assert from 'node:assert/strict';
import test from 'node:test';
import { renderRoute, nodes } from '../helpers/recordWorkflowHarness.mjs';
import { restorePersistedState } from '../../src/store/xbarStoreHelpers.ts';

const request = () => ({ action: 'Add Equipment' });
async function drawer(actionRequest = request(), changes = {}, cloud = {}) {
  return renderRoute('components/saas/flows', changes, '', {
    exportName: 'GlobalCreateDrawer',
    cloud,
    ui: { quickCreate: actionRequest },
  });
}
function field(f, label, value) {
  nodes(f.tree, (n) => n.props.label === label)[0].props.onChange(value);
  f.render();
}
function submit(f, label = 'Add Equipment') {
  const button = nodes(f.tree, (n) => n.props.children === label && n.props.variant === 'primary')[0];
  assert.ok(button, `Missing ${label}`);
  return button.props.onClick();
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const toasts = (f) => f.calls.filter(([kind]) => kind === 'toast').map(([, value]) => value);

test('create validation stays visible in the form instead of disappearing with its toast', async () => {
  const f = await drawer();
  await submit(f);
  f.render();
  assert.equal(nodes(f.tree, (n) => n.props.role === 'alert').length, 1);
  assert.match(nodes(f.tree, (n) => n.props.role === 'alert')[0].props.children, /equipment name/i);
});

test('a refused mutation preserves the draft and never closes, navigates or claims success', async () => {
  const f = await drawer(request(), { addRanchAsset: () => ({ ok: false, message: 'Role cannot manage assets.' }) });
  field(f, 'Equipment', 'Trailer');
  await submit(f);
  f.render();
  assert.equal(nodes(f.tree, (n) => n.props.label === 'Equipment')[0].props.value, 'Trailer');
  assert.equal(nodes(f.tree, (n) => n.props.role === 'alert').length, 1);
  assert.equal(toasts(f).at(-1).tone, 'error');
  assert.ok(!f.calls.some(([kind]) => kind === 'close' || kind === 'navigate'));
});

test('a thrown mutation is reported and leaves a retryable draft', async () => {
  const f = await drawer(request(), {
    addRanchAsset: () => {
      throw new Error('synthetic failure');
    },
  });
  field(f, 'Equipment', 'Trailer');
  await submit(f);
  f.render();
  assert.equal(toasts(f).at(-1).tone, 'error');
  assert.equal(nodes(f.tree, (n) => n.props.role === 'alert').length, 1);
  assert.equal(
    nodes(f.tree, (n) => n.props.children === 'Add Equipment' && n.props.variant === 'primary')[0].props.disabled,
    false,
  );
});

test('create waits for the device write and prevents repeated submits before it completes', async () => {
  let resolve;
  const completed = new Promise((r) => {
    resolve = r;
  });
  let writes = 0;
  const f = await drawer();
  f.state.addRanchAsset = () => {
    writes += 1;
    f.receipt = { name: 'xbar-live-workspace', completed };
    return { ok: true, id: 'trailer', message: 'Asset added.' };
  };
  f.render();
  field(f, 'Equipment', 'Trailer');
  const first = submit(f);
  const second = submit(f);
  await tick();
  assert.equal(writes, 1);
  assert.equal(toasts(f).length, 0);
  resolve(true);
  await Promise.all([first, second]);
  assert.equal(toasts(f).at(-1).tone, 'success');
  assert.match(toasts(f).at(-1).message, /Saved on this device/);
  assert.ok(f.calls.some(([kind]) => kind === 'navigate'));
});

test('a failed device write reports session-only progress without a false saved confirmation', async () => {
  const f = await drawer();
  f.state.addRanchAsset = () => {
    f.receipt = { name: 'xbar-live-workspace', completed: Promise.resolve(false) };
    return { ok: true, id: 'trailer', message: 'Asset added.' };
  };
  f.render();
  field(f, 'Equipment', 'Trailer');
  await submit(f);
  assert.equal(toasts(f).at(-1).tone, 'warning');
  assert.match(toasts(f).at(-1).message, /only in this session/);
  assert.equal(toasts(f).at(-1).duration, Infinity);
  assert.ok(!toasts(f).some((t) => t.tone === 'success'));
});

test('cloud use never labels a device acknowledgment as cloud-saved', async () => {
  const f = await drawer(request(), {}, { session: { user: { id: 'member-a' } } });
  f.state.addRanchAsset = () => {
    f.receipt = { name: 'xbar-live-workspace', completed: Promise.resolve(true) };
    return { ok: true, id: 'trailer', message: 'Asset added.' };
  };
  f.render();
  field(f, 'Equipment', 'Trailer');
  await submit(f);
  assert.match(toasts(f).at(-1).message, /Cloud sync runs separately/);
  assert.doesNotMatch(toasts(f).at(-1).message, /synced|saved to (the )?cloud/i);
});

test('late completion cannot close a newer create request or navigate away from it', async () => {
  let resolve;
  const completed = new Promise((r) => {
    resolve = r;
  });
  const f = await drawer();
  f.state.addRanchAsset = () => {
    f.receipt = { name: 'xbar-live-workspace', completed };
    return { ok: true, id: 'trailer', message: 'Asset added.' };
  };
  f.render();
  field(f, 'Equipment', 'Trailer');
  const pending = submit(f);
  f.ui.quickCreate = { action: 'Add Horse' };
  resolve(true);
  await pending;
  assert.equal(f.calls.length, 0);
});

test('late completion is suppressed after the signed-in account changes', async () => {
  let resolve;
  const f = await drawer(request(), {}, { session: { user: { id: 'account-a' } } });
  f.state.addRanchAsset = () => {
    f.receipt = {
      name: 'xbar-live-workspace',
      completed: new Promise((r) => {
        resolve = r;
      }),
    };
    return { ok: true, id: 'trailer', message: 'Asset added.' };
  };
  f.render();
  field(f, 'Equipment', 'Trailer');
  const pending = submit(f);
  f.cloud.session = { user: { id: 'account-b' } };
  resolve(true);
  await pending;
  assert.equal(f.calls.length, 0);
});

test('a missing or rejected persistence receipt never becomes a saved confirmation', async () => {
  for (const reject of [false, true]) {
    const f = await drawer();
    f.state.addRanchAsset = () => {
      if (reject) f.receipt = { name: 'xbar-live-workspace', completed: Promise.reject(new Error('storage rejected')) };
      return { ok: true, id: 'trailer', message: 'Asset added.' };
    };
    f.render();
    field(f, 'Equipment', 'Trailer');
    await submit(f);
    assert.equal(toasts(f).at(-1).tone, 'warning');
    assert.ok(!toasts(f).some((toast) => toast.tone === 'success'));
  }
});

test('a later write cannot substitute for the captured failed create receipt', async () => {
  let resolve;
  const f = await drawer();
  f.state.addRanchAsset = () => {
    f.receipt = {
      name: 'xbar-live-workspace',
      completed: new Promise((r) => {
        resolve = r;
      }),
    };
    return { ok: true, id: 'trailer', message: 'Asset added.' };
  };
  f.render();
  field(f, 'Equipment', 'Trailer');
  const pending = submit(f);
  f.receipt = { name: 'xbar-live-workspace', completed: Promise.resolve(true) };
  resolve(false);
  await pending;
  assert.equal(toasts(f).at(-1).tone, 'warning');
});

test('switching quick-create requests clears old draft and validation errors', async () => {
  const f = await drawer();
  await submit(f);
  field(f, 'Equipment', 'Old draft');
  f.ui.quickCreate = { action: 'Add Horse' };
  f.render();
  assert.equal(nodes(f.tree, (n) => n.props.label === 'Name')[0].props.value, '');
  assert.equal(nodes(f.tree, (n) => n.props.role === 'alert').length, 0);
});

test('a rejected async create exits its busy state without clearing the draft', async () => {
  const f = await drawer(
    { action: 'Add Expense' },
    {
      addExpenseReceipt: async () => {
        throw new Error('offline');
      },
    },
  );
  field(f, 'Description', 'Hay');
  field(f, 'Amount', '100');
  await submit(f, 'Add Expense');
  f.render();
  assert.equal(toasts(f).at(-1).tone, 'error');
  assert.equal(nodes(f.tree, (n) => n.props.label === 'Description')[0].props.value, 'Hay');
  assert.equal(
    nodes(f.tree, (n) => n.props.children === 'Add Expense' && n.props.variant === 'primary')[0].props.disabled,
    false,
  );
});

test('close while a write is pending cannot silently abandon its confirmation', async () => {
  let resolve;
  const f = await drawer();
  f.state.addRanchAsset = () => {
    f.receipt = {
      name: 'xbar-live-workspace',
      completed: new Promise((r) => {
        resolve = r;
      }),
    };
    return { ok: true, id: 'trailer', message: 'Asset added.' };
  };
  f.render();
  field(f, 'Equipment', 'Trailer');
  const pending = submit(f);
  f.render();
  nodes(f.tree, (n) => n.type === 'SlideOverDrawer')[0].props.onClose();
  assert.equal(nodes(f.tree, (n) => n.props.children === 'Cancel')[0].props.disabled, true);
  assert.ok(!f.calls.some(([kind]) => kind === 'close'));
  resolve(true);
  await pending;
  assert.equal(toasts(f).at(-1).tone, 'success');
});

test('shared toast defaults allow time to read and act while preserving explicit timing', async () => {
  const { useUiStore } = await import('../../src/store/useUiStore.ts');
  const { toast } = await import('sonner');
  const pushToast = useUiStore.getState().pushToast;
  for (const [input, expected] of [
    [{ message: 'Created', tone: 'success' }, 6000],
    [{ message: 'Refused', tone: 'error' }, 10000],
    [{ message: 'Check this', tone: 'warning' }, 10000],
    [{ message: 'Archived', action: { label: 'Undo', onClick() {} } }, 10000],
    [{ message: 'Keep visible', duration: Infinity }, Infinity],
    [{ message: 'Explicit timing', duration: 2500 }, 2500],
  ]) {
    const id = pushToast(input);
    assert.equal(toast.getToasts().find((entry) => entry.id === id).duration, expected);
  }
  useUiStore.getState().clearToasts();
});

test('a switched account cannot retry the old draft until the create request is reopened', async () => {
  let resolve;
  let writes = 0;
  const f = await drawer();
  f.state.addRanchAsset = () => {
    writes += 1;
    f.receipt = {
      name: 'xbar-live-workspace',
      completed:
        writes === 1
          ? new Promise((r) => {
              resolve = r;
            })
          : Promise.resolve(true),
    };
    return { ok: true, id: 'trailer', message: 'Asset added.' };
  };
  f.render();
  field(f, 'Equipment', 'Account A draft');
  const pending = submit(f);
  f.cloud.session = { user: { id: 'account-b' } };
  f.cloud.workspaceId = 'workspace-b';
  f.state.workspaceProfile = { ...f.state.workspaceProfile, businessName: 'Ranch B' };
  resolve(true);
  await pending;
  f.render();
  await submit(f);
  f.render();
  assert.equal(writes, 1, 'Retry must not submit the old account draft to the new account');
  assert.equal(toasts(f).length, 0);
  assert.match(nodes(f.tree, (n) => n.props.role === 'alert')[0].props.children, /reopen/);
  f.ui.quickCreate = request();
  f.render();
  assert.equal(nodes(f.tree, (n) => n.props.label === 'Equipment')[0].props.value, '');
  field(f, 'Equipment', 'Account B draft');
  await submit(f);
  assert.equal(writes, 2);
  assert.equal(toasts(f).at(-1).tone, 'success');
});

test('Back or Forward navigation during the device save is not replaced by the old destination', async () => {
  let resolve;
  const f = await drawer();
  f.state.addRanchAsset = () => {
    f.receipt = {
      name: 'xbar-live-workspace',
      completed: new Promise((r) => {
        resolve = r;
      }),
    };
    return { ok: true, id: 'trailer', message: 'Asset added.' };
  };
  f.render();
  field(f, 'Equipment', 'Trailer');
  const pending = submit(f);
  f.location = { key: 'back-navigation', pathname: '/horses' };
  f.render();
  resolve(true);
  await pending;
  assert.ok(!f.calls.some(([kind]) => kind === 'navigate'));
  assert.equal(toasts(f).at(-1).tone, 'success');
});

test('repeated validation updates one notification rather than stacking errors over the form', async () => {
  const f = await drawer();
  await submit(f);
  await submit(f);
  assert.equal(toasts(f).length, 2);
  assert.equal(toasts(f)[0].id, 'quick-create-feedback');
  assert.equal(toasts(f)[1].id, toasts(f)[0].id);
});

test('a clean workspace refresh preserves the open draft and its ability to submit', async () => {
  let writes = 0;
  const f = await drawer();
  f.state.addRanchAsset = (input) => {
    writes += 1;
    assert.equal(input.name, 'Draft across refresh');
    f.receipt = { name: 'xbar-live-workspace', completed: Promise.resolve(true) };
    return { ok: true, id: 'trailer', message: 'Asset added.' };
  };
  field(f, 'Equipment', 'Draft across refresh');
  const previousProfile = f.state.workspaceProfile;
  const refreshed = restorePersistedState(f.state);
  assert.deepEqual(refreshed.workspaceProfile, previousProfile);
  assert.notEqual(refreshed.workspaceProfile, previousProfile);
  Object.assign(f.state, refreshed);
  f.render();
  assert.equal(nodes(f.tree, (n) => n.props.label === 'Equipment')[0].props.value, 'Draft across refresh');
  await submit(f);
  assert.equal(writes, 1);
  assert.equal(toasts(f).at(-1).tone, 'success');
});

test('an equivalent refresh during device persistence does not suppress the confirmed result', async () => {
  let resolve;
  const f = await drawer();
  f.state.addRanchAsset = () => {
    f.receipt = { name: 'xbar-live-workspace', completed: new Promise((r) => (resolve = r)) };
    return { ok: true, id: 'trailer', message: 'Asset added.' };
  };
  field(f, 'Equipment', 'Trailer');
  const pending = submit(f);
  Object.assign(f.state, restorePersistedState(f.state));
  f.render();
  resolve(true);
  await pending;
  assert.equal(toasts(f).at(-1)?.tone, 'success');
  assert.ok(f.calls.some(([kind]) => kind === 'close'));
});

test('real workspace, local setup, record owner or role changes cannot submit the old draft', async () => {
  for (const change of [
    (f) => (f.cloud.workspaceId = 'another-workspace'),
    (f) => (f.state.workspaceProfile = { ...f.state.workspaceProfile, setupCompleteAt: 'new-local-workspace' }),
    (f) => (f.recordsOwner = 'another-record-owner'),
    (f) => (f.state.currentRole = 'Sales Lead'),
    (f) => (f.cloud.workspaceRole = 'Pending access'),
  ]) {
    const f = await drawer();
    field(f, 'Equipment', 'Old context draft');
    change(f);
    f.render();
    await submit(f);
    f.render();
    assert.ok(!f.calls.some(([kind]) => kind === 'unexpected-create' || kind === 'close' || kind === 'navigate'));
    assert.equal(toasts(f).length, 0);
    assert.match(nodes(f.tree, (n) => n.props.role === 'alert')[0].props.children, /reopen/);
  }
});

test('snapshot-only recovery pins the verified ranch even when the account and setup stamp match', async () => {
  for (const target of ['ranch-b', null, undefined]) {
    const f = await drawer(
      request(),
      {},
      {
        session: { user: { id: 'same-user' } },
        workspaceId: '',
        recoveryContext: { userId: 'same-user', workspaceId: 'ranch-a', workspaceRole: 'Admin' },
      },
    );
    field(f, 'Equipment', 'Ranch A draft');
    f.cloud.recoveryContext =
      target === undefined ? undefined : { userId: 'same-user', workspaceId: target, workspaceRole: 'Admin' };
    f.render();
    await submit(f);
    f.render();
    assert.ok(!f.calls.some(([kind]) => kind === 'unexpected-create' || kind === 'close' || kind === 'navigate'));
    assert.equal(toasts(f).length, 0);
    assert.match(nodes(f.tree, (n) => n.props.role === 'alert')[0].props.children, /reopen/);
  }
});

test('equivalent verified recovery context and edited business details preserve a draft', async () => {
  const recovery = { userId: 'same-user', workspaceId: 'ranch-a', workspaceRole: 'Admin' };
  const f = await drawer(
    request(),
    {},
    {
      session: { user: { id: 'same-user' } },
      workspaceId: '',
      recoveryContext: recovery,
    },
  );
  field(f, 'Equipment', 'Same ranch draft');
  Object.assign(f.state, restorePersistedState(f.state));
  f.state.workspaceProfile.businessName = 'Updated ranch business name';
  f.cloud.recoveryContext = { ...recovery };
  f.render();
  await submit(f);
  assert.equal(f.calls.filter(([kind]) => kind === 'unexpected-create').length, 1);
});

test('a recovery context belonging to another user never authorizes a draft', async () => {
  const f = await drawer(
    request(),
    {},
    {
      session: { user: { id: 'current-user' } },
      workspaceId: '',
      recoveryContext: { userId: 'different-user', workspaceId: 'ranch-a', workspaceRole: 'Admin' },
    },
  );
  field(f, 'Equipment', 'Wrong context draft');
  await submit(f);
  assert.ok(!f.calls.some(([kind]) => kind === 'unexpected-create'));
  assert.equal(toasts(f).length, 0);
});

test('a settled cloud workspace can keep working while local file promotion is incomplete', async () => {
  const f = await renderRoute('components/saas/flows', {}, '', {
    exportName: 'GlobalCreateDrawer',
    cloud: {
      session: { user: { id: 'same-user' } },
      workspaceId: 'same-ranch',
      autosaveReady: true,
      autosaveUnlocked: true,
    },
    recordsOwner: 'local',
    ui: { quickCreate: request() },
  });
  field(f, 'Equipment', 'Settled ranch draft');
  await submit(f);
  assert.equal(f.calls.filter(([kind]) => kind === 'unexpected-create').length, 1);
});

test('a newly adopted recovery grant clears only that screen’s previous failure toast', async () => {
  const visibleToasts = new Map([['unrelated', { message: 'Unrelated work is still pending.' }]]);
  const removed = [];
  let nextId = 0;
  const f = await renderRoute('ResetPassword', {}, '', {
    env: { VITE_SUPABASE_URL: 'https://synthetic.invalid', VITE_SUPABASE_ANON_KEY: 'synthetic-test-key' },
    cloud: {
      authReady: true,
      recoveryValid: true,
      passwordRecoveryGrant: 'first-validated-grant',
      updatePassword: async () => ({ ok: false, uncertain: true, message: 'We could not confirm that change.' }),
    },
    ui: {
      pushToast: (toast) => {
        const id = toast.id ?? `reset-result-${++nextId}`;
        visibleToasts.set(id, toast);
        return id;
      },
      removeToast: (id) => {
        removed.push(id);
        visibleToasts.delete(id);
      },
    },
  });
  for (const input of nodes(f.tree, (n) => n.type === 'input')) {
    input.props.onChange({ target: { value: 'synthetic-password' } });
  }
  f.render();
  await nodes(f.tree, (n) => n.type === 'form')[0].props.onSubmit({ preventDefault() {} });
  f.cloud.passwordRecoveryGrant = '';
  f.cloud.recoveryValid = false;
  f.render();
  assert.equal(nodes(f.tree, (n) => n.type === 'form').length, 0);
  assert.equal(visibleToasts.size, 2, 'the current uncertain outcome must remain visible');
  assert.deepEqual(removed, [], 'spending the old grant must not hide its result');

  f.cloud.passwordRecoveryGrant = 'second-validated-grant';
  f.cloud.recoveryValid = true;
  f.render();
  assert.equal(nodes(f.tree, (n) => n.type === 'form').length, 1);
  assert.equal(nodes(f.tree, (n) => n.props.role === 'alert').length, 0);
  assert.deepEqual(removed, ['reset-result-1']);
  assert.deepEqual([...visibleToasts.keys()], ['unrelated']);
  f.render();
  assert.deepEqual(removed, ['reset-result-1'], 'unchanged grants do not repeatedly dismiss notifications');
});
