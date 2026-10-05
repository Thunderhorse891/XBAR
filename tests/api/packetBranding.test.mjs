import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { register } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';

process.env.SUPABASE_URL = 'https://packet-branding-test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-key';
register(new URL('./fixtures/billingLoader.mjs', import.meta.url));
const { __setBillingSupabase } = await import('./fixtures/billingSupabaseStub.mjs');
const { default: handler } = await import('../../api/sale-packets.js');
const { loadHorseContext } = await import('../../api/_lib/horse-context.js');
const { createSectionedPdf } = await import('../../api/_lib/pdf.js');
const { buildServerSaleCredential, serverSealCode } = await import('../../api/_lib/sale-credential.js');
const { summarizeSealedPacket } = await import('../../api/_lib/buyer-verify.js');

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const OTHER_WORKSPACE = '22222222-2222-4222-8222-222222222222';
const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function png(width = 400, height = 100, color = 120, compressed = null) {
  const chunk = (name, data) => {
    const body = Buffer.concat([Buffer.from(name), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    const header = Buffer.alloc(4),
      tail = Buffer.alloc(4);
    header.writeUInt32BE(data.length);
    tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height, color);
  for (let row = 0; row < height; row += 1) rows[row * (width * 3 + 1)] = 0;
  return `data:image/png;base64,${Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', compressed ?? deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64')}`;
}
const LOGO = png();
const PROFILE = {
  workspace_id: WORKSPACE,
  ranch_name: 'Silver Spur Ranch',
  business_name: 'Silver Spur LLC',
  default_owner_name: 'Taylor Seller',
  ranch_manager_name: 'Morgan Manager',
  operations_email: 'sales@silverspur.example',
  payload: { packetLogoDataUrl: LOGO, contactPhone: '+1 555 010 0200', website: 'https://silverspur.example' },
};

function install({ profile = PROFILE, profileError = null, allow = true } = {}) {
  const reads = [],
    writes = [],
    uploads = [];
  const tables = {
    workspaces: [{ id: WORKSPACE, owner_user_id: allow ? USER : 'someone-else' }],
    workspace_memberships: [],
    workspace_subscription_profiles: [{ workspace_id: WORKSPACE, tier: 'Professional', billing_state: 'Active' }],
    horses: [{ workspace_id: WORKSPACE, horse_id: 'horse-1', name: 'Copper', owner_name: 'Taylor Seller' }],
    workspace_profiles: [profile, { ...PROFILE, workspace_id: OTHER_WORKSPACE, ranch_name: 'Foreign Ranch' }].filter(
      Boolean,
    ),
    documents: [],
    ownership_records: [],
    sale_packets: [],
    audit_logs: [],
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: USER, email: 'seller@example.test' } }, error: null }) },
    from(table) {
      assert.ok(table in tables, `Unexpected table ${table}`);
      const filters = [];
      let single = false,
        count = false,
        values = null;
      const query = {
        select(columns, options) {
          reads.push({ table, columns, filters });
          count = Boolean(options?.count);
          return this;
        },
        eq(key, value) {
          filters.push([key, value]);
          return this;
        },
        gte() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        maybeSingle() {
          single = true;
          return this;
        },
        upsert(row) {
          values = row;
          writes.push({ table, row });
          return this;
        },
        insert(row) {
          values = row;
          writes.push({ table, row });
          return this;
        },
        then(resolve, reject) {
          const rows = tables[table].filter((row) => filters.every(([key, value]) => row[key] === value));
          const error = table === 'workspace_profiles' ? profileError : null;
          return Promise.resolve({
            data: values ? null : error ? null : single ? (rows[0] ?? null) : rows,
            error,
            count: count ? rows.length : undefined,
          }).then(resolve, reject);
        },
      };
      return query;
    },
    rpc: async () => ({ data: 0, error: null }),
    storage: {
      from: (bucket) => ({
        upload: async (path, bytes) => {
          uploads.push({ bucket, path, bytes });
          return { error: null };
        },
        createSignedUrl: async () => ({ data: { signedUrl: 'https://download.example.test/packet' }, error: null }),
        download: async () => {
          throw new Error('No attachments expected');
        },
      }),
    },
  };
  __setBillingSupabase(client);
  return { client, reads, writes, uploads };
}
let counter = 0;
async function call(body = {}) {
  const req = Readable.from([JSON.stringify({ workspaceId: WORKSPACE, horseId: 'horse-1', ...body })]);
  req.method = 'POST';
  req.url = '/api/sale-packets';
  req.headers = { authorization: 'Bearer synthetic', host: 'localhost', 'x-forwarded-for': `10.4.0.${++counter}` };
  return new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      setHeader() {},
      end(payload) {
        resolve({ status: this.statusCode, body: JSON.parse(payload) });
      },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

async function inspectPdf(bytes) {
  const pdf = await PDFDocument.load(bytes);
  const texts = [],
    images = [];
  for (const page of pdf.getPages()) {
    const contents = page.node.Contents();
    const streams = contents?.asArray ? contents.asArray().map((entry) => pdf.context.lookup(entry)) : [contents];
    for (const stream of streams.filter(Boolean)) {
      const operators = inflateSync(stream.getContents()).toString('latin1');
      let x = 0,
        y = 0,
        size = 0,
        strong = false;
      for (const line of operators.split('\n')) {
        const font = /^\/(\S+) ([\d.]+) Tf$/.exec(line.trim());
        if (font) {
          size = Number(font[2]);
          strong = font[1].includes('Bold');
        }
        const position = /^1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm$/.exec(line.trim());
        if (position) {
          x = Number(position[1]);
          y = Number(position[2]);
        }
        const show = /^<([0-9A-Fa-f]*)> Tj$/.exec(line.trim());
        if (show)
          texts.push({ text: new TextDecoder('windows-1252').decode(Buffer.from(show[1], 'hex')), x, y, size, strong });
      }
      for (const match of operators.matchAll(/([\d.]+) 0 0 ([\d.]+) 0 0 cm\s+1 0 0 1 0 0 cm\s+\/(\S+) Do/g)) {
        images.push({ width: Number(match[1]), height: Number(match[2]), name: match[3] });
      }
    }
  }
  return { pdf, texts, images, text: texts.map((item) => item.text).join('\n') };
}

test('cloud packet uses authorized stored branding, seals all details and ignores forged request overrides', async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('Branding must not fetch external resources');
  };
  try {
    const fixture = install();
    const result = await call({
      profile: { ranchName: 'Forged Ranch' },
      branding: { displayName: 'Forged Ranch' },
      packetLogoDataUrl: 'https://evil.example/logo.png',
    });
    assert.equal(result.status, 200, result.body.message);
    const payload = JSON.parse(result.body.seal.payload);
    assert.equal(result.body.seal.version, 3);
    assert.deepEqual(payload.seller, {
      name: 'Taylor Seller',
      displayName: 'Silver Spur Ranch',
      email: 'sales@silverspur.example',
      phone: '+1 555 010 0200',
      website: 'https://silverspur.example/',
      logoDataUrl: LOGO,
      logoDigest: createHash('sha256')
        .update(Buffer.from(LOGO.split(',')[1], 'base64'))
        .digest('hex'),
    });
    assert.equal(fixture.uploads.length, 1);
    if (process.env.PACKET_BRANDING_REVIEW_PDF) {
      await writeFile(process.env.PACKET_BRANDING_REVIEW_PDF, fixture.uploads[0].bytes);
    }
    const parsed = await inspectPdf(fixture.uploads[0].bytes);
    for (const text of [
      'Silver Spur Ranch',
      'Taylor Seller',
      'sales@silverspur.example',
      '+1 555 010 0200',
      'https://silverspur.example',
      'Presented By',
      'XBAR Verification Seal',
      result.body.seal.sealCode,
    ])
      assert.ok(parsed.text.includes(text), `PDF missing ${text}`);
    assert.ok(parsed.text.includes('/app/verify/'));
    assert.ok(!parsed.text.includes('Forged Ranch'));
    assert.equal(parsed.images.length, 1, 'customer logo must be embedded once on cover');
    assert.ok(parsed.images[0].width <= 180 && parsed.images[0].height <= 72);
    assert.equal(parsed.images[0].width / parsed.images[0].height, 4);
    const profileRead = fixture.reads.find((read) => read.table === 'workspace_profiles');
    assert.match(profileRead.columns, /payload/);
    assert.deepEqual(profileRead.filters, [['workspace_id', WORKSPACE]]);
    assert.equal(
      fixture.writes.find((write) => write.table === 'sale_packets').row.payload.seal.payload,
      result.body.seal.payload,
    );
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test('profile read failures fail packet creation before upload and do not change template callers', async () => {
  const fixture = install({ profileError: { message: 'database offline' } });
  const result = await call();
  assert.equal(result.status, 500);
  assert.match(result.body.message, /profile|branding/i);
  assert.equal(fixture.uploads.length, 0);
  assert.ok(!fixture.writes.some((write) => write.table === 'sale_packets'));
  await assert.doesNotReject(loadHorseContext(fixture.client, WORKSPACE, 'horse-1'));
});

test('unauthorized workspace access never reads profile branding or stores a packet', async () => {
  const fixture = install({ allow: false });
  const result = await call();
  assert.equal(result.status, 403);
  assert.equal(fixture.uploads.length, 0);
  assert.ok(!fixture.reads.some((read) => read.table === 'workspace_profiles'));
});

test('legacy and removed logos yield a usable unbranded packet without fabricated identity', async () => {
  for (const profile of [
    null,
    { ...PROFILE, payload: {} },
    {
      ...PROFILE,
      ranch_name: 'Main Ranch',
      business_name: 'My Ranch LLC',
      default_owner_name: 'Operations Lead',
      ranch_manager_name: '',
      operations_email: 'owner@ranch.local',
      payload: { packetLogoDataUrl: '' },
    },
  ]) {
    const fixture = install({ profile });
    const result = await call();
    assert.equal(result.status, 200, result.body.message);
    const parsed = await inspectPdf(fixture.uploads[0].bytes);
    assert.equal(parsed.images.length, 0);
    assert.match(parsed.text, /XBAR Verification Seal/);
    for (const fake of ['Main Ranch', 'My Ranch LLC', 'Operations Lead', 'owner@ranch.local'])
      assert.ok(!parsed.text.includes(fake));
  }
});

test('invalid stored logos fail explicitly without external fetch or packet upload', async () => {
  const savedFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error('External logo fetch attempted');
  };
  try {
    for (const logo of [
      'https://example.test/logo.png',
      'data:image/svg+xml;base64,PHN2Zy8+',
      'data:image/png;base64,bm90IHBuZw==',
      png(2049, 1),
      `data:image/png;base64,${Buffer.alloc(256 * 1024 + 1).toString('base64')}`,
    ]) {
      const fixture = install({ profile: { ...PROFILE, payload: { ...PROFILE.payload, packetLogoDataUrl: logo } } });
      const result = await call();
      assert.equal(result.status, 500, `Invalid logo accepted: ${logo.slice(0, 40)}`);
      assert.match(result.body.message, /logo/i);
      assert.ok(!result.body.message.includes('External logo fetch attempted'));
      assert.equal(fixture.uploads.length, 0);
    }
  } finally {
    globalThis.fetch = savedFetch;
  }
});

test('customer logo stays bounded, preserves aspect ratio, and long identity cannot run off the PDF', async () => {
  for (const [width, height] of [
    [400, 100],
    [100, 400],
  ]) {
    const bytes = await createSectionedPdf({
      title: 'Sale Packet: Copper',
      customerLogoDataUrl: png(width, height),
      letterhead: 'A Very Long Ranch Name '.repeat(30),
      sections: [
        {
          heading: 'Presented By',
          lines: [
            'Email: ' + 'contact'.repeat(70) + '@ranch.example',
            'Website: https://ranch.example/' + 'long-path/'.repeat(80),
          ],
        },
      ],
    });
    const { pdf, texts, images } = await inspectPdf(bytes);
    assert.equal(images.length, 1);
    assert.ok(images[0].width <= 180 && images[0].height <= 72);
    assert.equal(images[0].width / images[0].height, width / height);
    const regular = await pdf.embedFont(StandardFonts.Helvetica),
      bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    for (const item of texts) {
      assert.ok(item.x >= 56 && item.y >= 28 && item.y + item.size <= 736, JSON.stringify(item));
      assert.ok(item.x + (item.strong ? bold : regular).widthOfTextAtSize(item.text, item.size) <= 557, item.text);
    }
    const resources = pdf.getPages()[0].node.Resources().lookup(PDFName.of('XObject'));
    assert.ok(resources, 'logo must be an actual PDF image');
  }
});

function sealInput(branding) {
  return {
    packetId: 'packet-brand',
    horseId: 'horse-1',
    context: { horse: { name: 'Copper' }, workspace: {} },
    documents: [],
    sealedAt: '2026-10-03T12:00:00.000Z',
    packetBranding: branding,
  };
}

test('every customer branding field changes the v3 seal and public verification uses its snapshot', async () => {
  const { normalizePacketBranding } = await import('../../api/_lib/packet-branding.js');
  const source = {
    ranchName: 'Silver Spur Ranch',
    businessName: 'Silver Spur LLC',
    defaultOwnerName: 'Taylor Seller',
    operationsEmail: 'sales@silverspur.example',
    contactPhone: '+1 555 010 0200',
    website: 'https://silverspur.example',
    packetLogoDataUrl: LOGO,
  };
  const seal = buildServerSaleCredential(sealInput(normalizePacketBranding(source)));
  for (const [field, value] of Object.entries({
    ranchName: 'Other Ranch',
    businessName: 'Other LLC',
    defaultOwnerName: 'Other Seller',
    operationsEmail: 'other@example.test',
    contactPhone: '555-1000',
    website: 'https://other.example',
    packetLogoDataUrl: png(400, 100, 80),
  })) {
    const changed = buildServerSaleCredential(sealInput(normalizePacketBranding({ ...source, [field]: value })));
    assert.notEqual(changed.digest, seal.digest, field);
  }
  const summary = summarizeSealedPacket({
    packet_id: 'packet-brand',
    payload: { seal, seller: { name: 'LIVE OR FORGED' } },
  });
  assert.equal(summary.anchored, true);
  assert.equal(summary.facts.sellerName, source.defaultOwnerName);
  assert.equal(summary.facts.sellerDisplayName, source.ranchName);
  assert.equal(summary.facts.sellerEmail, source.operationsEmail);
  assert.equal(summary.facts.sellerPhone, source.contactPhone);
  assert.equal(summary.facts.sellerWebsite, `${source.website}/`);
  assert.equal(summary.facts.sellerLogoDataUrl, LOGO);
  const forged = structuredClone(seal);
  forged.payload = forged.payload.replace('Taylor Seller', 'Forged Seller');
  assert.equal(
    summarizeSealedPacket({ payload: { seal: forged } }).anchored,
    false,
    'modified payload cannot pass its old digest',
  );
});

test('historical v1/v2 seals verify exact stored bytes without rebuilding as v3', () => {
  for (const version of [1, 2]) {
    const payload = JSON.stringify({
      version,
      packetId: 'old-packet',
      horse: { name: 'Historical Horse' },
      workspace: { businessName: 'Historic LLC', ranchName: 'Historic Ranch' },
      sealedAt: '2025-01-01',
    });
    const digest = createHash('sha256').update(payload).digest('hex');
    const seal = {
      version,
      anchor: 'server',
      payload,
      digest,
      sealCode: serverSealCode(digest),
      sealedAt: '2025-01-01',
    };
    const summary = summarizeSealedPacket({ packet_id: 'old-packet', payload: { seal } });
    assert.equal(summary.anchored, true);
    assert.equal(summary.facts.sellerBusinessName, 'Historic LLC');
    assert.equal(summary.facts.sellerRanchName, 'Historic Ranch');
    assert.equal(summary.facts.sellerName, '');
    assert.equal(summary.facts.sellerLogoDataUrl, '');
  }
});

test('JPEG customer logos embed at their actual aspect ratio and remain separate from XBAR artwork', async () => {
  const jpeg = await readFile(new URL('../../public/brand/og-card.jpg', import.meta.url));
  const logo = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
  const { validatePacketLogo } = await import('../../api/_lib/packet-branding.js');
  const dimensions = validatePacketLogo(logo);
  const branding = {
    logo: await readFile(new URL('../../public/brand/xbar-report-horse.png', import.meta.url)),
    mark: await readFile(new URL('../../public/brand/xbar-original-lockup-480.png', import.meta.url)),
    watermark: await readFile(new URL('../../public/brand/xbar-report-watermark.png', import.meta.url)),
  };
  const bytes = await createSectionedPdf({ title: 'Seller Packet', customerLogoDataUrl: logo, branding, sections: [] });
  const parsed = await inspectPdf(bytes);
  assert.ok(parsed.text.includes('XBAR'), 'customer artwork cannot replace the XBAR identity label');
  // Customer image follows the XBAR page watermark and header artwork.
  const image = parsed.images[2];
  assert.ok(image && image.width <= 180 && image.height <= 72);
  assert.ok(Math.abs(image.width / image.height - dimensions.width / dimensions.height) < 0.00001);
  assert.equal(parsed.images.length, 4, 'customer, XBAR header, watermark, and footer are all present');
});

test('public seal integrity refuses mismatched code, packet identity, and malformed logo snapshots', () => {
  const legacyPayload = JSON.stringify({ version: 2, packetId: 'packet-one', horse: {}, workspace: {} });
  const digest = createHash('sha256').update(legacyPayload).digest('hex');
  const seal = { version: 2, anchor: 'server', payload: legacyPayload, digest, sealCode: serverSealCode(digest) };
  assert.equal(summarizeSealedPacket({ packet_id: 'packet-two', payload: { seal } }).anchored, false);
  assert.equal(
    summarizeSealedPacket({ payload: { seal: { ...seal, sealCode: 'SEAL-0000-0000-0000' } } }).anchored,
    false,
  );
  for (const logo of ['https://remote.example/logo.png', 'data:image/svg+xml;base64,PHN2Zy8+']) {
    const payload = JSON.stringify({
      version: 3,
      packetId: 'packet-one',
      seller: { logoDataUrl: logo, logoDigest: '' },
    });
    const nextDigest = createHash('sha256').update(payload).digest('hex');
    assert.equal(
      summarizeSealedPacket({
        payload: { seal: { ...seal, version: 3, payload, digest: nextDigest, sealCode: serverSealCode(nextDigest) } },
      }).anchored,
      false,
    );
  }
});

test('a CRC-valid PNG with an empty compressed raster is refused rather than replaced by blank pixels', async () => {
  const dataUrl = png(400, 100, 120, deflateSync(Buffer.alloc(0)));
  await assert.rejects(createSectionedPdf({ title: 'Packet', sections: [], customerLogoDataUrl: dataUrl }), /logo/i);
});

test('a JPEG truncated after SOS cannot silently become a padded logo', async () => {
  const jpeg = await readFile(new URL('../../public/brand/og-card.jpg', import.meta.url));
  let offset = 2;
  while (offset < jpeg.length - 2) {
    const marker = jpeg[offset + 1];
    offset += 2 + jpeg.readUInt16BE(offset + 2);
    if (marker === 0xda) break;
  }
  for (const keptScanBytes of [1, 4, 50]) {
    const broken = Buffer.concat([jpeg.subarray(0, offset + keptScanBytes), Buffer.from([255, 217])]);
    await assert.rejects(
      createSectionedPdf({
        title: 'Packet',
        sections: [],
        customerLogoDataUrl: `data:image/jpeg;base64,${broken.toString('base64')}`,
      }),
      /logo/i,
    );
  }
});

test('alpha-channel and interlaced palette PNGs retain supported export behavior', async () => {
  const fixtures = [
    // 5x9 RGBA PNG with partial alpha.
    'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAJCAYAAAD6reaeAAAAFUlEQVR4nGM0qvjQwIAGmNAFBqkgAI6xAixn7gF8AAAAAElFTkSuQmCC',
    // 9x5 Adam7 palette PNG with transparent background.
    'iVBORw0KGgoAAAANSUhEUgAAAAkAAAAFAgMAAAGdOh5uAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAJUExURQAAAP8AAP///2cZZB4AAAABdFJOUwBA5thmAAAAAWJLR0QCZgt8ZAAAAAd0SU1FB+oKAxQBDsaCMuEAAAATSURBVAjXY2CAA1EQEQpihIIxAAiMAT8kRtBdAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTEwLTAzVDIwOjAxOjE0KzAwOjAwBIs42AAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMC0wM1QyMDowMToxNCswMDowMHXWgGQAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTAtMDNUMjA6MDE6MTQrMDA6MDAiw6G7AAAAAElFTkSuQmCC',
  ];
  for (const base64 of fixtures) {
    const bytes = await createSectionedPdf({
      title: 'Packet',
      sections: [],
      customerLogoDataUrl: `data:image/png;base64,${base64}`,
    });
    const parsed = await inspectPdf(bytes);
    assert.equal(parsed.images.length, 1);
  }
});

test('PNG raster decompression refuses excess pixels and illegal row filters', async () => {
  const extra = deflateSync(Buffer.alloc(120102)); // 400x100 RGB requires exactly 120100 bytes.
  const badFilter = Buffer.alloc(120100);
  badFilter[0] = 5;
  for (const compressed of [extra, deflateSync(badFilter)]) {
    await assert.rejects(
      createSectionedPdf({ title: 'Packet', sections: [], customerLogoDataUrl: png(400, 100, 120, compressed) }),
      /logo/i,
    );
  }
});

test('an early JPEG end marker cannot evade strict decoding by adding another final marker', async () => {
  const jpeg = await readFile(new URL('../../public/brand/og-card.jpg', import.meta.url));
  let offset = 2;
  while (offset < jpeg.length - 2) {
    const marker = jpeg[offset + 1];
    offset += 2 + jpeg.readUInt16BE(offset + 2);
    if (marker === 0xda) break;
  }
  const broken = Buffer.concat([jpeg.subarray(0, offset + 1), Buffer.from([255, 217, 0, 0, 255, 217])]);
  await assert.rejects(
    createSectionedPdf({
      title: 'Packet',
      sections: [],
      customerLogoDataUrl: `data:image/jpeg;base64,${broken.toString('base64')}`,
    }),
    /logo/i,
  );
});
