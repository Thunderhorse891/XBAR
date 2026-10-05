import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canSharePacketFile,
  downloadPreparedSalePacket,
  isTrustedPacketDownloadUrl,
  MAX_SHARE_PACKET_BYTES,
  packetShareFileName,
  prepareSalePacketFile,
  sharePreparedSalePacket,
} from '../src/lib/salePacketSharing.js';
import type { SalePacketBuild } from '../src/types/xbar.js';
import type { LocalFileEntry } from '../src/lib/localFileVault.js';

const workspaceId = '12345678-1234-1234-1234-123456789012';
const url = `https://project.supabase.co/storage/v1/object/sign/sale-packets/${workspaceId}/horse-1/packet-1.pdf?token=signed`;
const packet: SalePacketBuild = {
  id: 'packet-1',
  horseId: 'horse-1',
  createdAt: '',
  createdBy: 'Admin',
  watermark: 'Buyer',
  documentIds: [],
  includesBillOfSale: false,
  status: 'generated',
  fileName: 'Bella.pdf',
  downloadUrl: 'https://attacker.test/private',
};
const context = {
  ownerId: workspaceId,
  workspaceId,
  accessToken: 'test-token',
  supabaseUrl: 'https://project.supabase.co',
  isCurrent: () => true,
};
const pdf = new Blob([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55, 255, 254, 0, 128])], { type: 'application/pdf' });
function entry(overrides: Partial<LocalFileEntry> = {}): LocalFileEntry {
  return {
    key: 'vault-test',
    workspaceId,
    generated: true,
    name: 'Bella.pdf',
    type: 'application/pdf',
    size: pdf.size,
    storedAt: '',
    blob: pdf,
    ...overrides,
  };
}
const localPacket = { ...packet, localFileKey: 'vault-test' };
const noFetch = (() => {
  throw new Error('No network allowed');
}) as typeof fetch;

test('only exact configured storage origin, namespace and packet can be fetched', () => {
  assert.equal(isTrustedPacketDownloadUrl(url, context.supabaseUrl, workspaceId, packet.id), true);
  for (const changed of [
    url.replace('project.supabase.co', 'attacker.test'),
    url.replace('https:', 'http:'),
    url.replace('project.supabase.co', 'project.supabase.co.attacker.test'),
    url.replace('/sign/', '/public/'),
    url.replace(workspaceId, 'foreign-workspace'),
    url.replace('/horse-1/', '/horse%2fsecret/'),
    url.replace('/packet-1.pdf', '/packet-2.pdf'),
    url.replace('?token=signed', ''),
    `${url}#fragment`,
    url.replace('https://', 'https://user:secret@'),
    url.replace('/sale-packets/', '/sale-packets/extra/'),
    'javascript:alert(1)',
    'data:application/pdf;base64,JVBERg==',
    'blob:foreign',
  ])
    assert.equal(isTrustedPacketDownloadUrl(changed, context.supabaseUrl, workspaceId, packet.id), false, changed);
});

test('file names cannot become filesystem paths and extension reflects actual type', () => {
  assert.equal(packetShareFileName('../../private\\file.html', 'PDF'), '------private-file.pdf');
  assert.equal(packetShareFileName('', 'HTML'), 'xbar-sale-packet.html');
});

test('local packet preserves every byte and performs no URL fetch', async () => {
  const prepared = await prepareSalePacketFile(localPacket, context, {
    readLocalFile: async () => entry(),
    fetch: noFetch,
  });
  assert.equal(prepared.file.name, 'Bella.pdf');
  assert.deepEqual(new Uint8Array(await prepared.file.arrayBuffer()), new Uint8Array(await pdf.arrayBuffer()));
});

test('missing, foreign, unrecognized, empty and mislabeled local files refuse', async () => {
  for (const stored of [
    null,
    entry({ workspaceId: 'other' }),
    entry({ generated: false }),
    entry({ blob: new Blob([]) }),
    entry({ blob: new Blob(['not pdf']) }),
    entry({ type: 'image/svg+xml' }),
  ]) {
    await assert.rejects(
      prepareSalePacketFile(localPacket, context, { readLocalFile: async () => stored, fetch: noFetch }),
    );
  }
});

test('late local resolution is discarded after workspace invalidation', async () => {
  let active = true;
  await assert.rejects(
    prepareSalePacketFile(
      localPacket,
      { ...context, isCurrent: () => active },
      {
        readLocalFile: async () => {
          active = false;
          return entry();
        },
        fetch: noFetch,
      },
    ),
    /changed/,
  );
});

test('cloud packet refreshes signed link and never fetches imported downloadUrl or sends auth to storage', async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  const prepared = await prepareSalePacketFile(packet, context, {
    readLocalFile: async () => null,
    fetch: (async (input, options) => {
      calls.push({ url: String(input), options });
      return calls.length === 1
        ? Response.json({ ok: true, packets: [{ packetId: packet.id, horseId: packet.horseId, downloadUrl: url }] })
        : new Response(pdf);
    }) as typeof fetch,
  });
  assert.match(calls[0].url, /\/api\/sale-packets\?workspaceId=/);
  assert.deepEqual(calls[0].options?.headers, { Authorization: 'Bearer test-token' });
  assert.equal(calls[1].url, url);
  assert.equal(calls[1].options?.headers, undefined);
  assert.equal(calls[1].options?.credentials, 'omit');
  assert.equal(calls[1].options?.redirect, 'error');
  assert.deepEqual(new Uint8Array(await prepared.file.arrayBuffer()), new Uint8Array(await pdf.arrayBuffer()));
});

test('cloud errors, ambiguous/missing matches and hostile URLs stop before any file fetch', async () => {
  const match = { packetId: packet.id, horseId: packet.horseId, downloadUrl: url };
  for (const payload of [
    { ok: false },
    { ok: true, packets: [] },
    { ok: true, packets: [match, match] },
    { ok: true, packets: [{ ...match, horseId: 'wrong' }] },
    { ok: true, packets: [{ ...match, downloadUrl: 'https://attacker.test/file.pdf' }] },
  ]) {
    let calls = 0;
    await assert.rejects(
      prepareSalePacketFile(packet, context, {
        readLocalFile: async () => null,
        fetch: (async () => {
          calls += 1;
          return Response.json(payload);
        }) as typeof fetch,
      }),
    );
    assert.equal(calls, 1);
  }
});

test('failed, oversized and non-PDF downloads do not become files', async () => {
  for (const response of [
    new Response('bad', { status: 403 }),
    new Response('large', { headers: { 'content-length': String(MAX_SHARE_PACKET_BYTES + 1) } }),
    new Response('<html>login</html>'),
  ]) {
    let calls = 0;
    await assert.rejects(
      prepareSalePacketFile(packet, context, {
        readLocalFile: async () => null,
        fetch: (async () =>
          ++calls === 1
            ? Response.json({ ok: true, packets: [{ packetId: packet.id, horseId: packet.horseId, downloadUrl: url }] })
            : response) as typeof fetch,
      }),
    );
  }
});

async function withNavigator(value: unknown, run: () => Promise<void>) {
  const old = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value });
  try {
    await run();
  } finally {
    if (old) Object.defineProperty(globalThis, 'navigator', old);
    else Reflect.deleteProperty(globalThis, 'navigator');
  }
}
const prepared = { file: new File([pdf], 'Bella.pdf', { type: 'application/pdf' }), format: 'PDF' as const };

test('file capability, rather than text sharing capability, gates handoff', async () => {
  for (const nav of [
    undefined,
    {
      share: () => {
        throw new Error('must not share');
      },
    },
    { share() {}, canShare: () => false },
    {
      share() {},
      canShare: () => {
        throw new Error('unsupported');
      },
    },
  ]) {
    await withNavigator(nav, async () => {
      assert.equal(canSharePacketFile(prepared.file), false);
      assert.equal((await sharePreparedSalePacket(prepared, () => true)).status, 'unavailable');
    });
  }
});

test('Web Share receives the actual file without URL; no upload claim is made', async () => {
  let received: ShareData | undefined;
  await withNavigator(
    {
      canShare: ({ files }: ShareData) => files?.[0] === prepared.file,
      share: async (data: ShareData) => {
        received = data;
      },
    },
    async () => {
      assert.deepEqual(await sharePreparedSalePacket(prepared, () => true), { status: 'handed-off' });
      assert.equal(received?.files?.[0], prepared.file);
      assert.equal(received?.url, undefined);
    },
  );
});

test('cancel, rejection and stale clicks never report handoff or automatically download', async () => {
  for (const [error, status] of [
    [new DOMException('cancel', 'AbortError'), 'cancelled'],
    [new Error('denied'), 'error'],
  ] as const) {
    await withNavigator(
      {
        canShare: () => true,
        share: async () => {
          throw error;
        },
      },
      async () => {
        assert.equal((await sharePreparedSalePacket(prepared, () => true)).status, status);
      },
    );
  }
  await withNavigator(
    {
      canShare: () => true,
      share: () => {
        throw new Error('must not reach');
      },
    },
    async () => {
      assert.equal((await sharePreparedSalePacket(prepared, () => false)).status, 'error');
      assert.equal((await downloadPreparedSalePacket(prepared, () => false)).status, 'error');
    },
  );
});

test('cloud refresh follows the server credential when the studio record has a different local id', async () => {
  const saved = {
    ...packet,
    id: 'local-build-id',
    credential: {
      version: 3,
      anchor: 'server' as const,
      sealCode: 'seal',
      digest: 'digest',
      sealedAt: '',
      payload: JSON.stringify({ packetId: packet.id, horseId: packet.horseId }),
    },
  };
  let calls = 0;
  const result = await prepareSalePacketFile(saved, context, {
    readLocalFile: async () => null,
    fetch: (async () =>
      ++calls === 1
        ? Response.json({ ok: true, packets: [{ packetId: packet.id, horseId: packet.horseId, downloadUrl: url }] })
        : new Response(pdf)) as typeof fetch,
  });
  assert.equal(result.format, 'PDF');
});

test('a stalled authorized download times out and a new preparation can retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = prepareSalePacketFile(packet, context, {
    readLocalFile: async () => null,
    fetch: ((_url, options) =>
      new Promise<Response>((_resolve, reject) => {
        options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), {
          once: true,
        });
      })) as typeof fetch,
  });
  const refusal = assert.rejects(pending, /timed out/);
  t.mock.timers.tick(45_000);
  await refusal;
  t.mock.timers.reset();
  const retried = await prepareSalePacketFile(localPacket, context, {
    readLocalFile: async () => entry(),
    fetch: noFetch,
  });
  assert.equal(retried.format, 'PDF');
});

test('cloud lookup accepts legacy server ids from an owned storage path but refuses mismatched credentials', async () => {
  let calls = 0;
  const restored = { ...packet, id: 'local-id', downloadUrl: url };
  const result = await prepareSalePacketFile(restored, context, {
    readLocalFile: async () => null,
    fetch: (async () =>
      ++calls === 1
        ? Response.json({ ok: true, packets: [{ packetId: packet.id, horseId: packet.horseId, downloadUrl: url }] })
        : new Response(pdf)) as typeof fetch,
  });
  assert.equal(result.format, 'PDF');
  const mismatched = {
    ...packet,
    credential: {
      version: 3,
      anchor: 'server' as const,
      sealCode: '',
      digest: '',
      sealedAt: '',
      payload: JSON.stringify({ packetId: packet.id, horseId: 'different' }),
    },
  };
  await assert.rejects(
    prepareSalePacketFile(mismatched, context, { readLocalFile: async () => null, fetch: noFetch }),
    /does not match/,
  );
});
