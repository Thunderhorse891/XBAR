import assert from 'node:assert/strict';
import test from 'node:test';
import { renderRoute, nodes } from '../helpers/recordWorkflowHarness.mjs';

const lead = () => ({
  id: 'lead-1',
  horseId: 'horse-context',
  name: 'Synthetic buyer',
  shareReady: true,
  stage: 'New',
  channel: 'Site Inquiry',
  lastTouch: 'Today',
});
async function setup() {
  const f = await renderRoute('BuyerDealRoom', { salesLeads: [lead()] });
  f.writes = [];
  f.events = [];
  f.state.updateSalesLead = (id, patch) => {
    f.writes.push({ id, patch });
    f.state.salesLeads = f.state.salesLeads.map((entry) => (entry.id === id ? { ...entry, ...patch } : entry));
    return { ok: true, message: 'Updated.' };
  };
  f.state.logBuyerRoomEvent = (event) => {
    f.events.push(event);
    return { ok: true, message: 'Recorded.' };
  };
  f.render();
  return f;
}
function button(f) {
  return nodes(f.tree, (n) => ['Revoke', 'Mark not ready'].includes(n.props.children))[0];
}
const messages = (f) => f.calls.filter(([kind]) => kind === 'toast').map(([, value]) => value);

test('refused readiness changes do not log buyer events or claim success', async () => {
  const f = await setup();
  f.state.updateSalesLead = () => ({ ok: false, message: 'Role cannot manage sales.' });
  f.render();
  button(f).props.onClick();
  f.render();
  assert.equal(f.events.length, 0);
  assert.equal(messages(f).at(-1).tone, 'error');
  assert.equal(nodes(f.tree, (n) => n.props.role === 'alert').length, 1);
  assert.equal(f.state.salesLeads[0].shareReady, true);
});

test('thrown readiness changes retain an inline error and never emit success', async () => {
  const f = await setup();
  f.state.updateSalesLead = () => {
    throw new Error('Synthetic mutation failure');
  };
  f.render();
  assert.doesNotThrow(() => button(f).props.onClick());
  f.render();
  assert.equal(f.events.length, 0);
  assert.equal(messages(f).at(-1).tone, 'error');
  assert.equal(nodes(f.tree, (n) => n.props.role === 'alert').length, 1);
});

test('successful readiness changes are named accurately and repeated clicks are no-ops', async () => {
  const f = await setup();
  const click = button(f).props.onClick;
  click();
  click();
  assert.equal(f.writes.length, 1);
  assert.equal(f.events.length, 1);
  assert.equal(f.state.salesLeads[0].shareReady, false);
  assert.match(f.events[0].note, /not ready for sharing/i);
  assert.doesNotMatch(f.events[0].note, /access revoked/i);
  assert.match(messages(f)[0].message, /Existing links.*unchanged/i);
  assert.doesNotMatch(messages(f)[0].message, /Access revoked/);
});

test('a changed buyer is refused before mutation or event logging', async () => {
  const f = await setup();
  const click = button(f).props.onClick;
  f.state.salesLeads = [{ ...f.state.salesLeads[0], horseId: 'new-horse' }];
  click();
  assert.equal(f.writes.length, 0);
  assert.equal(f.events.length, 0);
  assert.equal(messages(f).at(-1).tone, 'error');
});

test('a changed account is refused before mutation or event logging', async () => {
  const f = await setup();
  const click = button(f).props.onClick;
  f.cloud.session = { user: { id: 'another-account' } };
  click();
  assert.equal(f.writes.length, 0);
  assert.equal(f.events.length, 0);
  assert.equal(messages(f).at(-1).tone, 'error');
});

test('an okay return without the expected local state change is not a success', async () => {
  const f = await setup();
  f.state.updateSalesLead = () => ({ ok: true, message: 'No write occurred.' });
  f.render();
  button(f).props.onClick();
  assert.equal(f.events.length, 0);
  assert.equal(messages(f).at(-1).tone, 'error');
});

test('a failed history entry reports partial progress accurately', async () => {
  const f = await setup();
  f.state.logBuyerRoomEvent = () => ({ ok: false, message: 'History unavailable.' });
  f.render();
  button(f).props.onClick();
  assert.equal(f.state.salesLeads[0].shareReady, false);
  assert.equal(messages(f).at(-1).tone, 'warning');
  assert.match(messages(f).at(-1).message, /history/i);
});

test('read-only roles do not see an enabled readiness mutation', async () => {
  const f = await setup();
  f.state.currentRole = 'Owner';
  f.render();
  assert.equal(button(f).props.disabled, true);
});

test('a history exception reports the applied change without a false complete outcome', async () => {
  const f = await setup();
  f.state.logBuyerRoomEvent = () => {
    throw new Error('Synthetic history failure');
  };
  f.render();
  assert.doesNotThrow(() => button(f).props.onClick());
  assert.equal(f.state.salesLeads[0].shareReady, false);
  assert.equal(messages(f).at(-1).tone, 'warning');
  assert.match(messages(f).at(-1).message, /history entry could not be confirmed/);
});

test('a removed buyer and a late permission change are refused even through an old handler', async () => {
  for (const change of ['remove', 'role']) {
    const f = await setup();
    const click = button(f).props.onClick;
    if (change === 'remove') f.state.salesLeads = [];
    else f.state.currentRole = 'Owner';
    click();
    assert.equal(f.writes.length, 0);
    assert.equal(f.events.length, 0);
    assert.equal(messages(f).at(-1).tone, 'error');
  }
});

test('Sales pipeline readiness copy never claims the public link is live or private', async () => {
  for (const ready of [true, false]) {
    const f = await renderRoute('Sales', { salesLeads: [{ ...lead(), shareReady: ready }] });
    assert.equal(nodes(f.tree, (n) => n.props.children === (ready ? 'Sharing ready' : 'Sharing not ready')).length, 1);
    assert.equal(nodes(f.tree, (n) => ['Sale link live', 'Sale link private'].includes(n.props.children)).length, 0);
  }
});
