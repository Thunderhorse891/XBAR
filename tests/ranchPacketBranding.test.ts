import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { isSupportedPacketVerifier, LEGACY_V5_VERIFIER_SHA256 } from '../src/lib/savedPacketCompatibility.js';
import { normalizePacketBranding, validatePacketLogo } from '../api/_lib/packet-branding.js';
import { buildLocalSalePacket, buildValidatedLocalSalePacket } from '../src/lib/localSalePacketGenerator.js';
import { verifySaleCredential } from '../src/lib/saleCredential.js';
import type { HorseRecord, WorkspaceProfile } from '../src/types/xbar.js';

const logo =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAJUlEQVR4nO3NMQEAAAgDoGn/zhpjDxRgkkvDVlaxWCwWi8XiigcuqQEnnWbPLQAAAABJRU5ErkJggg==';
const profile = {
  ranchName: 'Rock & River',
  businessName: 'R&R Horses',
  defaultOwnerName: 'Jo Seller',
  operationsEmail: 'jo@example.test',
  contactPhone: '+1 555 0100',
  website: 'ranch.example.test',
  packetLogoDataUrl: logo,
} as WorkspaceProfile;
const horse = {
  id: 'branding-horse',
  name: 'Bella',
  barnName: 'Bella',
  breed: 'Quarter Horse',
  sex: 'Mare',
  color: 'Sorrel',
  foaledOn: '2018-05-01',
  registry: 'AQHA',
  registrationNumber: 'TEST-123',
  microchipId: '',
  owner: 'Jo Seller',
  status: 'Pasture',
  lastVetVisit: '2026-08-01',
  sale: { askPrice: 15000, listingState: 'Listed' },
  gallery: [],
  alerts: [],
} as unknown as HorseRecord;
const packet = (workspaceProfile: WorkspaceProfile = profile) =>
  buildLocalSalePacket({
    horse,
    workspaceProfile,
    documents: [],
    selectedDocumentIds: [],
    generatedBy: 'Admin',
    now: new Date('2026-10-03T00:00:00Z'),
  });

test('v6 renders and seals one normalized ranch logo/name/contact snapshot', () => {
  const result = packet();
  const seller = JSON.parse(result.credential.payload).seller;
  assert.equal(result.credential.version, 6);
  assert.equal(seller.displayName, 'Rock & River');
  assert.equal(seller.website, 'https://ranch.example.test/');
  assert.equal(seller.logoDigest, createHash('sha256').update(validatePacketLogo(logo)!.bytes).digest('hex'));
  assert.match(result.html, /Rock &amp; River · Buyer Sale Packet/);
  assert.match(result.html, /id="xbar-ranch-logo"/);
  assert.match(result.html, /alt="Rock &amp; River logo" width="40" height="20"/);
  for (const field of ['name', 'ranch', 'business', 'email', 'phone', 'website'])
    assert.ok(result.html.includes(`id="xbar-seller-${field}"`));
  assert.ok(result.html.includes('XBAR Verifiable Sale Credential v6'));
  assert.equal(verifySaleCredential(result.credential.payload, result.credential.digest).valid, true);
});

test('every changed branding or contact fact changes the local seal', () => {
  const original = packet();
  for (const [field, value] of Object.entries({
    ranchName: 'Other Ranch',
    businessName: 'Other business',
    defaultOwnerName: 'Other Seller',
    operationsEmail: 'other@example.test',
    contactPhone: '999',
    website: 'https://other.example.test',
    packetLogoDataUrl: '',
  })) {
    assert.notEqual(packet({ ...profile, [field]: value }).credential.digest, original.credential.digest, field);
  }
});

test('legacy empty profiles still generate packets without customer-logo markup', () => {
  const result = packet({
    ranchName: '',
    businessName: '',
    defaultOwnerName: '',
    operationsEmail: '',
  } as WorkspaceProfile);
  assert.ok(!result.html.includes('<img id="xbar-ranch-logo"'));
  assert.ok(result.html.includes('XBAR™ Buyer Sale Packet'));
  assert.equal(JSON.parse(result.credential.payload).seller.logoDigest, '');
});

test('business and real manager identity substitute for missing ranch and placeholder owner', () => {
  const branding = normalizePacketBranding({
    businessName: 'Actual Co',
    ranchName: 'Main Ranch',
    defaultOwnerName: 'Operations Lead',
    ranchManagerName: 'Real Person',
  });
  assert.equal(branding.displayName, 'Actual Co');
  assert.equal(branding.name, 'Real Person');
});

test('unsafe, malformed, truncated, oversized and remote logo data fail closed', () => {
  for (const bad of [
    'https://attacker.test/logo.png',
    'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
    'data:image/png;base64,SGVsbG8=',
    'data:image/jpeg;base64,/9j/wAARCAABAAEDAREAAhEAAxEA/9k=',
    logo.slice(0, -4),
    logo.replace('AAACg', 'AAACk'),
    `data:image/png;base64,${'A'.repeat(350000)}`,
  ]) {
    assert.throws(() => validatePacketLogo(bad));
    assert.throws(() => packet({ ...profile, packetLogoDataUrl: bad }));
  }
});

test('malicious contact strings remain inert and unsafe website schemes are refused', () => {
  const result = packet({
    ...profile,
    ranchName: '<img src=x onerror=alert(1)>',
    contactPhone: '<script>bad</script>',
  });
  assert.ok(!result.html.includes('<img src=x'));
  assert.match(result.html, /&lt;script&gt;bad&lt;\/script&gt;/);
  for (const website of [
    'javascript:alert(1)',
    'data:text/html,bad',
    'https://user:secret@example.test',
    'example.test\nATTACK',
  ])
    assert.throws(() => packet({ ...profile, website }));
});

test('vault compatibility admits only the exact reviewed v5 verifier, never arbitrary older scripts', async () => {
  const html = await readFile('tests/fixtures/packet-v5.generated.html', 'utf8');
  const script = /<script>([\s\S]*)<\/script>/.exec(html)![1];
  assert.equal(createHash('sha256').update(script).digest('hex'), LEGACY_V5_VERIFIER_SHA256);
  assert.equal(isSupportedPacketVerifier(script, 5), true);
  assert.equal(isSupportedPacketVerifier(script + ' ', 5), false);
  assert.equal(isSupportedPacketVerifier(script, 6), false);
  assert.equal(isSupportedPacketVerifier('alert(1)', 5), false);
});

test('the application factory rejects CRC-valid but empty logo raster before any artifact is returned', async () => {
  const packetLogoDataUrl =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAACElEQVR4nAMAAAAAAUgGidIAAAAASUVORK5CYII=';
  const params = {
    horse,
    workspaceProfile: { ...profile, packetLogoDataUrl },
    documents: [],
    selectedDocumentIds: [],
    generatedBy: 'Admin',
  };
  await assert.rejects(buildValidatedLocalSalePacket(params), /could not be decoded/);
  const valid = await buildValidatedLocalSalePacket({ ...params, workspaceProfile: profile });
  assert.match(valid.html, /xbar-ranch-logo/);
});

test('indexed PNG logos cannot omit their required palette', () => {
  const missingPalette =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAMAAAAoyzS7AAAACklEQVR4nGNgAAAAAgABSK+kcQAAAABJRU5ErkJggg==';
  assert.throws(() => validatePacketLogo(missingPalette), /valid PNG or JPEG/);
});
