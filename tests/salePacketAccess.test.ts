import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { readRefreshedPacket, serverPacketIdOf } from '../src/lib/salePacketAccess.js';
import type { SaleCredentialSeal } from '../src/types/xbar.js';

/*
 * A saved cloud packet opens by asking the server to sign it again, not by the
 * link saved when it was built. That link lives 72 hours; a seller goes back to
 * a packet for weeks. The server half is pinned in
 * tests/api/salePacketRefresh.test.mjs. This file pins the app half: which id
 * it asks with, what it makes of the answer, and that both saved-packet lists
 * actually ask.
 */

const SERVER_ID = 'packet-0b0e4c2a-5d7f-4f7e-9c1a-2d3e4f5a6b7c';

function seal(anchor: 'server' | 'local', payload: string): SaleCredentialSeal {
  return {
    version: 4,
    anchor,
    digest: 'a'.repeat(64),
    sealCode: 'AAAA-BBBB',
    sealedAt: '2026-09-01T12:00:00Z',
    payload,
  } as SaleCredentialSeal;
}

test('the server id recorded on a packet is the one it asks with', () => {
  assert.equal(serverPacketIdOf({ serverPacketId: SERVER_ID }), SERVER_ID);
});

test('a packet saved before the id was recorded is found by the id its server seal names', () => {
  const credential = seal('server', JSON.stringify({ version: 4, packetId: SERVER_ID, horseId: 'horse-1' }));
  assert.equal(serverPacketIdOf({ credential }), SERVER_ID);
});

test('there is nothing to ask the server for when it never saw the packet', () => {
  // A local seal names an id the browser made up; the server has no such packet.
  const local = seal('local', JSON.stringify({ packetId: SERVER_ID }));
  assert.equal(serverPacketIdOf({ credential: local }), '');
  assert.equal(serverPacketIdOf({}), '');
});

test('an id that is not shaped like a server id is not sent, wherever it came from', () => {
  for (const forged of ['packet-1', 'javascript:alert(1)', `${SERVER_ID}&workspaceId=x`, '', ' ']) {
    assert.equal(serverPacketIdOf({ serverPacketId: forged }), '', `recorded ${JSON.stringify(forged)}`);
    const credential = seal('server', JSON.stringify({ packetId: forged }));
    assert.equal(serverPacketIdOf({ credential }), '', `sealed ${JSON.stringify(forged)}`);
  }
  for (const payload of ['not json', 'null', '"packet"', JSON.stringify({ packetId: 42 })]) {
    assert.equal(serverPacketIdOf({ credential: seal('server', payload) }), '', payload);
  }
});

test('a malformed recorded id falls back to the one in the server seal', () => {
  const credential = seal('server', JSON.stringify({ packetId: SERVER_ID }));
  assert.equal(serverPacketIdOf({ serverPacketId: 'packet-1', credential }), SERVER_ID);
});

test('the fresh link is taken only from the answer for the packet that was asked for', () => {
  const url = 'https://storage.example/sale-packets/w/h/p.pdf?token=fresh';
  assert.deepEqual(readRefreshedPacket({ ok: true, packets: [{ packetId: SERVER_ID, downloadUrl: url }] }, SERVER_ID), {
    ok: true,
    url,
  });

  const other = readRefreshedPacket(
    { ok: true, packets: [{ packetId: 'packet-1c1f5d3b-6e8a-4a8f-8d2b-3e4f5a6b7c8d', downloadUrl: url }] },
    SERVER_ID,
  );
  assert.equal(other.ok, false, "another packet's link must never open in this one's place");
  assert.ok(!other.ok && /no longer stored/.test(other.message));
});

test("a refusal keeps the server's own reason", () => {
  const lostAccess = readRefreshedPacket(
    { ok: false, message: 'This user does not have access to the requested workspace.' },
    SERVER_ID,
    false,
  );
  assert.deepEqual(lostAccess, { ok: false, message: 'This user does not have access to the requested workspace.' });

  const gone = readRefreshedPacket(
    { ok: false, code: 'packet_not_found', message: 'This sale packet is no longer stored in this workspace.' },
    SERVER_ID,
    false,
  );
  assert.ok(!gone.ok && /no longer stored/.test(gone.message));

  const pathRefused = readRefreshedPacket(
    {
      ok: true,
      packets: [
        {
          packetId: SERVER_ID,
          downloadUrl: '',
          downloadUnavailable: 'The stored file does not belong to this workspace, so it was not signed.',
        },
      ],
    },
    SERVER_ID,
  );
  assert.ok(!pathRefused.ok && /does not belong to this workspace/.test(pathRefused.message));
});

test('an unreadable answer is a failure, never a link', () => {
  for (const [payload, httpOk] of [
    [{}, false],
    [null, true],
    ['<html>502</html>', false],
    [{ ok: true }, true],
    [{ ok: true, packets: [{ packetId: SERVER_ID }] }, true],
    [{ ok: true, packets: [{ packetId: SERVER_ID, downloadUrl: 'https://x.example/p.pdf' }] }, false],
  ] as const) {
    const result = readRefreshedPacket(payload, SERVER_ID, httpOk);
    assert.equal(result.ok, false, JSON.stringify(payload));
    assert.ok(!result.ok && result.message.length > 0);
  }
});

test('both saved-packet lists re-sign a cloud packet before falling back to its saved link', async () => {
  for (const file of ['src/routes/SalePacketStudio.tsx', 'src/routes/Documents.tsx']) {
    const source = await readFile(file, 'utf8');
    const reSign = source.indexOf('{serverPacketIdOf(packet) ? (');
    const savedLink = source.indexOf('isNavigableFileUrl(packet.downloadUrl) ? (');
    assert.ok(reSign > -1, `${file} never asks the server to sign a saved packet again`);
    assert.ok(savedLink > -1, `${file}: the saved-link branch moved; re-point this pin`);
    assert.ok(reSign < savedLink, `${file} offers the 72-hour link ahead of a fresh one`);
    assert.match(source, /await openSalePacketInTab\(packet, \{/, `${file} opens packets without the re-sign path`);
  }
});

test('re-opening asks the server to sign again, through GET — it never rebuilds the packet', async () => {
  const api = await readFile('src/lib/backendApi.ts', 'utf8');
  const start = api.indexOf('export async function refreshSalePacketDownload');
  assert.ok(start > -1);
  const body = api.slice(start);
  assert.match(body, /packetId: serverPacketId/);
  // POST /api/sale-packets assembles a new PDF and counts it against the plan.
  assert.doesNotMatch(body, /postJson|method: 'POST'/);

  const opener = await readFile('src/lib/openStoredFile.ts', 'utf8');
  assert.match(opener, /refreshSalePacketDownload\(auth, serverPacketId\)/);
  // The tab must still open before the network round trip, or the popup is blocked.
  assert.ok(opener.indexOf("window.open('', '_blank')") < opener.indexOf('access = await resolve()'));
});

test('a packet the cloud builds keeps its server id', async () => {
  const wizard = await readFile('src/components/SalePacketWizard.tsx', 'utf8');
  assert.match(wizard, /serverPacketId = remote\.packetId;/);
  assert.match(wizard, /createSalePacketBuild\(\{[^}]*\bserverPacketId,/s);

  const store = await readFile('src/store/useXbarStore.ts', 'utf8');
  assert.match(store, /serverPacketId: input\.serverPacketId,/);

  // Restored backups are shape-checked field by field; the new field is too.
  const helpers = await readFile('src/store/xbarStoreHelpers.ts', 'utf8');
  assert.match(helpers, /optionalStrings: \['fileName', 'downloadUrl', 'serverPacketId', 'localFileKey'\]/);
});
