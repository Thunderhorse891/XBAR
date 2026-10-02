import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SALE_PACKET_WINDOW_DAYS, salePacketsInWindow } from '../src/lib/salePacketAllowance.js';

/*
 * Audit F11, client side: the plan gate counted every packet build this
 * device had ever made, so it would refuse a packet the server -- which now
 * counts the last 30 days -- would allow.
 */

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-02T12:00:00.000Z');
const daysAgo = (days: number) => ({ createdAt: new Date(now.getTime() - days * DAY).toISOString() });

test('only packets from the last 30 days count', () => {
  assert.equal(SALE_PACKET_WINDOW_DAYS, 30);
  assert.equal(salePacketsInWindow([daysAgo(1), daysAgo(29), daysAgo(30), daysAgo(31), daysAgo(400)], now), 3);
});

test('a packet whose date cannot be read is counted, not assumed old', () => {
  assert.equal(salePacketsInWindow([{ createdAt: '' }, { createdAt: 'last spring' }, {}], now), 3);
});

test('the stored usage is recomputed from the window, not the lifetime total', async () => {
  const helpers = await readFile('src/store/xbarStoreHelpers.ts', 'utf8');
  assert.match(helpers, /salePacketsGenerated: salePacketsInWindow\(salePacketBuilds\),/);
  assert.doesNotMatch(helpers, /salePacketsGenerated: salePacketBuilds\.length/);
});
