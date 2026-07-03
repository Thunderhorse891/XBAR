import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('sale packets page builds real packets — no fake share links or toast-only sharing', async () => {
  const source = await readFile('src/routes/SalePacketStudio.tsx', 'utf8');
  assert.doesNotMatch(source, /xbar\.app\/packet/, 'hard-coded fake packet URL must not return');
  assert.match(source, /SalePacketWizard/, 'packet creation must go through the real wizard (createSalePacketBuild)');
  assert.match(source, /salePacketBuilds/, 'page must list persisted packet records');
});

test('buyer revoke persists a buyer event, not only telemetry', async () => {
  const source = await readFile('src/routes/BuyerDealRoom.tsx', 'utf8');
  assert.match(source, /logBuyerRoomEvent\(\{[^}]*kind: 'deal-status'/s, 'revoking access must log a persisted buyer event');
});
