import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { SALE_PACKET_WINDOW_DAYS, checkSalePacketCapacity } from '../../api/_lib/entitlements.js';
import { subscriptionPlans } from '../../api/_lib/subscription-plans.js';

/*
 * Audit F11: the server counted every sale_packets row the workspace had ever
 * written. A controlled database holding 30 historical Professional packets
 * refused packet 31 -- and kept refusing it however long the customer kept
 * paying. The allowance now renews: packets generated in the last 30 days.
 *
 * The table below is real enough to matter: it filters on created_at the way
 * PostgREST does, so the window is exercised rather than merely named.
 */

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-10-02T12:00:00.000Z');
const daysAgo = (days) => new Date(NOW.getTime() - days * DAY).toISOString();

function tableOf(rows) {
  return {
    from(table) {
      assert.equal(table, 'sale_packets');
      const filters = [];
      const query = {
        select: () => query,
        eq(field, value) {
          filters.push((row) => row[field] === value);
          return query;
        },
        gte(field, value) {
          filters.push((row) => row[field] >= value);
          return query;
        },
        then(resolve) {
          resolve({ count: rows.filter((row) => filters.every((keep) => keep(row))).length, error: null });
        },
      };
      return query;
    },
  };
}

const packets = (count, ageDays, workspace = 'ws-1') =>
  Array.from({ length: count }, () => ({ workspace_id: workspace, created_at: daysAgo(ageDays) }));

const professional = subscriptionPlans.Professional.limits;

test("the audit's case: 30 old Professional packets no longer refuse packet 31", async () => {
  const result = await checkSalePacketCapacity(tableOf(packets(30, 45)), 'ws-1', 1, professional, NOW);
  assert.equal(result.ok, true, 'a paying subscriber is not held to a lifetime ceiling');
  assert.equal(result.used, 0);
});

test('30 packets inside the window still refuse the 31st, and say when it renews', async () => {
  const result = await checkSalePacketCapacity(tableOf(packets(30, 3)), 'ws-1', 1, professional, NOW);
  assert.equal(result.ok, false);
  assert.match(result.message, /30 sale packets per 30 days/);
  assert.match(result.message, /renews as earlier packets pass 30 days/);
  assert.match(result.message, /reopening or resending a packet never uses it/);
});

test('the window edge: a packet exactly 30 days old still counts, one a moment older does not', async () => {
  const atEdge = await checkSalePacketCapacity(tableOf(packets(30, 30)), 'ws-1', 1, professional, NOW);
  assert.equal(atEdge.ok, false);
  const pastEdge = await checkSalePacketCapacity(
    tableOf(packets(30, 30 + 1 / (24 * 60))),
    'ws-1',
    1,
    professional,
    NOW,
  );
  assert.equal(pastEdge.ok, true);
});

test("another workspace's packets never count against this one", async () => {
  const result = await checkSalePacketCapacity(tableOf(packets(30, 1, 'ws-other')), 'ws-1', 1, professional, NOW);
  assert.equal(result.ok, true);
});

test('the client counts the same window the server enforces', () => {
  const client = readFileSync('src/lib/salePacketAllowance.ts', 'utf8');
  const clientWindow = Number(/export const SALE_PACKET_WINDOW_DAYS = (\d+);/.exec(client)?.[1]);
  assert.equal(clientWindow, SALE_PACKET_WINDOW_DAYS, 'a screen and a server that disagree refuse or promise wrongly');
  // The existing database trigger can still enforce a lifetime ceiling.
  // New checkout must not promise automatic renewal before that is aligned.
  const screen = readFileSync('src/routes/Subscriptions.tsx', 'utf8');
  assert.doesNotMatch(screen, new RegExp(`'sale packets'\\)\\} every ${SALE_PACKET_WINDOW_DAYS} days`));
});

test('only generating a packet is metered; reading or re-signing one is not', () => {
  const route = readFileSync('api/sale-packets.js', 'utf8');
  const postOnly = route.indexOf("if (req.method !== 'POST')");
  const metered = route.indexOf('checkSalePacketCapacity(supabase');
  assert.ok(postOnly > 0 && metered > postOnly, 'the GET (re-sign) path returns before the allowance is checked');
});

test('the final database trigger uses the API window and meters only genuinely new packet identities', () => {
  const dir = 'supabase/migrations';
  const sql = readdirSync(dir)
    .sort()
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(`${dir}/${name}`, 'utf8'))
    .join('\n');
  const triggers = [
    ...sql.matchAll(
      /create trigger trg_sale_packets_enforce_commercial_limits[\s\S]*?execute function public\.(\w+)\(\);/gi,
    ),
  ];
  assert.equal(
    triggers.at(-1)?.[1],
    'xbar_enforce_sale_packet_rolling_allowance',
    'the active packet trigger is still the lifetime gate',
  );
  const gate = sql.slice(
    sql.lastIndexOf('create or replace function public.xbar_enforce_sale_packet_rolling_allowance()'),
  );
  assert.match(gate, new RegExp(`created_at >= issued_at - interval '${SALE_PACKET_WINDOW_DAYS * 24} hours'`));
  assert.ok(
    gate.indexOf('pg_advisory_xact_lock') < gate.indexOf('from public.sale_packets'),
    'serialize before the first packet read',
  );
  assert.match(gate, /new\.created_at := existing_created_at;/);
  assert.match(gate, /new\.created_at := issued_at;/);
  assert.match(gate, /detail = 'xbar_sale_packet_allowance_reached'/);
});

test('an authoritative quota rejection after upload cleans up and returns the same public quota code', () => {
  const route = readFileSync('api/sale-packets.js', 'utf8');
  const recordFailure = route.slice(
    route.indexOf('if (recordError || issued !== true)'),
    route.indexOf('const { data: signed }'),
  );
  assert.match(recordFailure, /if \(rejected\) await supabase\.storage/, 'only definite rejections clean up');
  assert.match(recordFailure, /remove\(\[packetPath\]\)[\s\S]+P0001[\s\S]+xbar_sale_packet_allowance_reached/);
  assert.match(recordFailure, /sendJson\(res, 403,[\s\S]+code: 'sale_packet_limit_reached'/);
  assert.match(recordFailure, /storage_limit_reached/, 'preserve the distinct storage error');
});
