import assert from 'node:assert/strict';
import test from 'node:test';
import { buildOperationsPriorities } from '../src/lib/operationsPriority.js';
import { buildTodayWork } from '../src/lib/todayWork.js';

const now = new Date('2026-06-05T12:00:00');
const documentBase = { uploadedBy: 'Manager', source: 'Manual Upload' as const, confidence: 1, duplicateRisk: 'Low' as const, extractedTextPreview: '', summary: '', entities: {} };
const leadBase = { channel: 'Referral' as const, horseId: 'horse-1', lastTouch: '2026-05-20', savedListing: false, shareReady: false };

function priorities() {
  return buildOperationsPriorities({
    horseNames: { 'horse-1': 'Blue Moon' },
    careRows: [{ horseId: 'horse-1', horseName: 'Blue Moon', priority: 2, signals: [{ key: 'coggins', label: 'Coggins', status: 'due', detail: 'Coggins overdue', dueDate: '2026-06-04' }] }],
    transferRows: [{ horseId: 'horse-1', horseName: 'Blue Moon', transferStatus: 'Attention Required', dueDate: '2026-06-05', pendingCount: 1, reasons: ['Transfer packet missing'] }],
    documents: [{ ...documentBase, id: 'doc-1', title: 'Registration review', type: 'Registration', uploadedAt: '2026-06-03', state: 'Needs Review' }],
    salesLeads: [
      { ...leadBase, id: 'lead-overdue', name: 'Avery', stage: 'New', nextFollowUp: '2026-06-01' },
      { ...leadBase, id: 'lead-later', name: 'Morgan', stage: 'New', nextFollowUp: '2026-06-20' },
    ],
  }, now);
}

test('daily briefing ranks ownership and overdue work first', () => { const result = priorities(); assert.equal(result.top[0]?.kind, 'Ownership'); assert.equal(result.overdueCount, 3); assert.equal(result.dueCount, 4); });
test('overdue sales follow-ups become due even when the lead is new', () => { const result = priorities(); const lead = result.items.find((item) => item.id === 'sale-lead-overdue'); assert.equal(lead?.urgency, 'Due'); assert.equal(lead?.timing, 'Overdue'); });
test('future new leads stay clear until their follow-up approaches', () => { const result = priorities(); const lead = result.items.find((item) => item.id === 'sale-lead-later'); assert.equal(lead?.urgency, 'Clear'); assert.equal(result.top.some((item) => item.id === 'sale-lead-later'), false); });
test('today work starts from live workspace setup state instead of static fixtures', () => {
  const result = buildTodayWork({
    horses: [],
    documents: [],
    ownershipRecords: [],
    expenseReceipts: [],
    salesLeads: [],
    sharedListings: [],
    workspaceProfile: {
      ranchName: 'Thunder Horse Ranch',
      businessName: 'XBAR Holdings',
      defaultOwnerName: 'Erin Wyrick',
      defaultOwnerEntity: 'Thunder Horse Ranch LLC',
      ranchManagerName: 'Erin Wyrick',
      operationsEmail: 'ops@xbar.test',
      defaultBarn: 'Barn A',
      defaultPasture: 'North Pasture',
      workspaceShortcuts: [],
      setupCompleteAt: '2026-07-01',
    },
    now,
  });

  assert.equal(result[0]?.id, 'setup-add-first-animal');
  assert.equal(result[0]?.source, 'Workspace Setup');
  assert.equal(result.some((item) => item.title === 'Check north pasture water trough'), false);
});
