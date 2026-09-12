import assert from 'node:assert/strict';
import test from 'node:test';
import { decideWorkspaceSetupGate, type WorkspaceSetupGateInput } from '../src/lib/workspaceSetupGate.js';

// A device this account has used before: the local store already holds the
// finished profile, and there is a live cloud session over the top of it.
const settledCloudMember: WorkspaceSetupGateInput = {
  workspaceHydrated: true,
  workspaceReady: true,
  cloudStatus: 'signed-in',
  cloudSettled: true,
};

test('a workspace nobody has read yet waits', () => {
  assert.equal(decideWorkspaceSetupGate({ ...settledCloudMember, workspaceHydrated: false }), 'loading');
});

test('a cold device waits for the cloud rather than calling the ranch unfinished', () => {
  assert.equal(
    decideWorkspaceSetupGate({
      workspaceHydrated: true,
      workspaceReady: false,
      cloudStatus: 'signed-in',
      cloudSettled: false,
    }),
    'loading',
    'local storage being empty on a new device is not evidence that the account never finished setup',
  );
});

test('the cloud store still working out who is here is not an answer either', () => {
  assert.equal(
    decideWorkspaceSetupGate({
      workspaceHydrated: true,
      workspaceReady: false,
      cloudStatus: 'loading',
      cloudSettled: false,
    }),
    'loading',
  );
});

test('a genuinely new account reaches setup once the cloud has answered', () => {
  assert.equal(
    decideWorkspaceSetupGate({
      workspaceHydrated: true,
      workspaceReady: false,
      cloudStatus: 'signed-in',
      cloudSettled: true,
    }),
    'setup',
    'the cloud has been asked and had nothing; waiting past that would strand a new customer on a loading screen',
  );
});

test('an empty workspace with no cloud to consult goes straight to setup', () => {
  for (const cloudStatus of ['unavailable', 'signed-out'] as const) {
    assert.equal(
      decideWorkspaceSetupGate({ workspaceHydrated: true, workspaceReady: false, cloudStatus, cloudSettled: false }),
      'setup',
      `${cloudStatus}: there is no second copy coming, so the local one is the answer`,
    );
  }
});

test('a set-up workspace renders without waiting on a re-sync', () => {
  assert.equal(decideWorkspaceSetupGate(settledCloudMember), 'allow');
  assert.equal(
    decideWorkspaceSetupGate({ ...settledCloudMember, cloudSettled: false }),
    'allow',
    'an ordinary token refresh re-runs hydration and drops this flag; blanking a working screen for it would be a new defect',
  );
  assert.equal(
    decideWorkspaceSetupGate({ ...settledCloudMember, cloudStatus: 'loading', cloudSettled: false }),
    'allow',
  );
});
