import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buyerFollowUpPath, buyersPath, legacyBuyerDealRoomPath } from '../src/lib/buyerRoutes.js';

test('buyer follow-up uses canonical buyer routes', () => {
  assert.equal(buyersPath, '/buyers');
  assert.equal(legacyBuyerDealRoomPath, '/buyer-deal-room');
  assert.equal(buyerFollowUpPath(), '/buyers');
  assert.equal(buyerFollowUpPath('lead-1'), '/buyers/lead-1');
  assert.equal(buyerFollowUpPath('lead with space'), '/buyers/lead%20with%20space');
});

test('buyer workflow links do not navigate to the legacy deal-room page', async () => {
  const files = [
    'src/pages/Dashboard.tsx',
    'src/routes/AnimalProfile.tsx',
    'src/routes/SalePacketStudio.tsx',
    'src/routes/SalesPipeline.tsx',
    'src/routes/TodayWork.tsx',
    'src/routes/layouts/MainLayout.tsx',
  ];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /['"`]\/buyer-deal-room['"`]/, `${file} should use buyerFollowUpPath() instead of the legacy route`);
  }
});
