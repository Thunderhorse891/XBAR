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
  assert.match(
    source,
    /logBuyerRoomEvent\(\{[^}]*kind: 'deal-status'/s,
    'revoking access must log a persisted buyer event',
  );
});

test('a buyer watermark fits the page and is still legible on it', async () => {
  const source = await readFile('src/lib/localSalePacketGenerator.ts', 'utf8');

  /*
   * The same two sizes, now chosen by class rather than interpolated into the
   * stylesheet. Interpolation made the CSS per-packet, and a per-packet
   * stylesheet cannot be sealed by a fixed digest — which left CSS free to
   * hide the verifier's verdict and draw a forged PASS over it.
   */
  assert.match(
    source,
    /const watermarkClass = watermark\.length <= 8 \? 'watermark--tight' : 'watermark--wide'/,
    'a long buyer watermark must step down in size rather than run off the page',
  );
  assert.match(source, /\.watermark--tight\{font-size:78px\}/, 'the short mark keeps its size');
  assert.match(source, /\.watermark--wide\{font-size:clamp\(32px,5vw,54px\)\}/, 'and the long one steps down');
  // Shrinking to fit was the tempting fix and the wrong one: at 6% opacity a
  // 20px mark is invisible on paper, so a long mark wraps inside a bounded
  // width instead.
  assert.match(source, /\.watermark\{[^}]*width:74vw/, 'the mark must be bounded by the page, not by nowrap');
  assert.doesNotMatch(source, /\.watermark\{[^}]*white-space:nowrap/, 'a bounded mark has to be allowed to wrap');
  assert.match(
    source,
    /<div class="watermark \$\{watermarkClass\}" id="xbar-watermark">\$\{escapeHtml\(watermark\)\}<\/div>/,
    'the watermark is buyer-supplied text and must be escaped, under a stable id the verifier can find',
  );
});

test('a packet with no watermark still carries one', async () => {
  const source = await readFile('src/lib/localSalePacketGenerator.ts', 'utf8');

  assert.match(
    source,
    /export function resolvePacketWatermark\(raw\?: string\): string \{\s*return raw\?\.trim\(\) \|\| 'XBAR';/,
    'an unwatermarked packet is the outcome this field exists to prevent',
  );
});

/*
 * The stamp and the seal must come from ONE resolution.
 *
 * The renderer resolved `params.watermark?.trim() || 'XBAR'` inline. Repeating
 * that expression at the seal would have looked equivalent and drifted the
 * first time one side was edited — and a packet whose printed watermark and
 * sealed watermark disagree is worse than one with neither, because the
 * verifier would then report tampering on an untouched packet.
 */
test('the stamped watermark and the sealed watermark are the same value', async () => {
  const source = await readFile('src/lib/localSalePacketGenerator.ts', 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  // Resolved once, above the seal.
  const resolveAt = code.indexOf('const watermark = resolvePacketWatermark(params.watermark);');
  const sealAt = code.indexOf('const credential = buildPacketCredential({');
  assert.ok(resolveAt > -1, 'the packet must resolve its watermark once');
  assert.ok(sealAt > resolveAt, 'and do it before sealing, or the seal cannot use it');

  // Both bounds measured from the same anchor.
  const seal = code.slice(sealAt, code.indexOf('});', sealAt));
  assert.match(seal, /\r?\n\s*watermark,\r?\n/, 'the resolved value must be what is sealed');

  assert.doesNotMatch(
    code,
    /params\.watermark\?\.trim\(\) \|\| 'XBAR'/,
    'a second inline resolution is how the stamp and the seal drift apart',
  );
});

/*
 * Sealing it is only half the fix. The verifier rehashes the PAYLOAD, so an
 * edit to the watermark on the page leaves the digest matching — the check
 * would say pass over a packet re-attributed to someone else.
 */
test('the verifier compares the stamp on the page with the one in the record', async () => {
  const verifier = await readFile('src/lib/packetVerifierScript.ts', 'utf8');
  const code = verifier.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  assert.match(code, /getElementById\('xbar-watermark'\)/, 'the rendered stamp has to be read');
  assert.match(code, /shown !== parsed\.watermark/, 'and compared against the sealed record');
  // Removing it entirely must not read as agreement.
  assert.match(code, /if \(!stamp\) \{/, 'a deleted watermark is a tampered packet, not a missing check');
});

test('a document type buyers may not see is never offered, selected, or embedded', async () => {
  const generator = await readFile('src/lib/localSalePacketGenerator.ts', 'utf8');
  const wizard = await readFile('src/components/SalePacketWizard.tsx', 'utf8');

  // `Breeding Contract` is a commercial agreement with a third party. It is a
  // Ready document on the horse, so it was ticked by default and — once the
  // packet started embedding files — its full contents were sent to a stranger
  // under the heading "approved documents".
  assert.doesNotMatch(
    generator,
    /const buyerSafeDocumentTypes = new Set<DocumentRecord\['type'\]>\(\[[^\]]*'Breeding Contract'/s,
    'a breeding contract must not be classified buyer-safe',
  );

  // The function named itself buyer-safe and returned every Ready document with
  // a flag nothing downstream read.
  assert.match(
    generator,
    /record\.state === 'Ready' && isBuyerSafeDocumentType\(record\.type\)/,
    'the buyer-safe set must withhold, not merely flag',
  );

  assert.match(
    wizard,
    /document\.state === 'Ready' && isBuyerSafeDocumentType\(document\.type\)/,
    'the wizard must not offer or default-select a document buyers may not see',
  );
});

test('the packet seal covers the bytes of every embedded file', async () => {
  const generator = await readFile('src/lib/localSalePacketGenerator.ts', 'utf8');

  // Without this the seal covers document TITLES while the packet carries the
  // documents: swap the base64 behind "Coggins 2026" and every sealed fact
  // still matches, under a note telling the buyer a matching code proves the
  // packet is unaltered.
  assert.match(
    generator,
    /digest: sha256Bytes\(base64ToBytes\(file\.dataUrl\.slice\(file\.dataUrl\.indexOf\(','\) \+ 1\)\)\)/,
    'each attachment must be fingerprinted by its decoded bytes, so `shasum -a 256` on the saved file prints the recorded digest',
  );
  assert.match(
    generator,
    /attachments: params\.attachments,/,
    'the packet must pass its embedded files to the credential',
  );
  assert.match(
    generator,
    /and the bytes of the \$\{attachments\.length\} embedded file/,
    'the seal note must say the file contents are covered',
  );
});

test('the packet publishes what it was sealed from', async () => {
  const generator = await readFile('src/lib/localSalePacketGenerator.ts', 'utf8');

  /*
   * A seal nobody can recompute is decoration. The packet printed a code and a
   * digest and told the buyer that comparing the code with the seller's proved
   * the packet unaltered — but published neither the sealed record nor any way
   * to rehash the embedded files, so swapping an attachment and leaving the
   * printed code alone passed the buyer's instructed check.
   */
  assert.match(
    generator,
    /<pre class="verify__payload" id="xbar-credential-payload">\$\{escapeHtml\(credential\.payload\)\}<\/pre>/,
    'the sealed record itself must be published, or the digest cannot be recomputed',
  );
  assert.match(
    generator,
    /data-xbar-file="\$\{escapeHtml\(file\.id\)\}"/,
    'each embedded file must be identifiable so it can be matched to its sealed entry',
  );
});

test('the packet rehashes its own files rather than trusting the printed seal', async () => {
  // The script lives in its own module now: a CSP hash covers exact bytes, so
  // isolating those bytes gives the hash one obvious source.
  const script = await readFile('src/lib/packetVerifierScript.ts', 'utf8');

  assert.match(script, /crypto\.subtle\.digest\('SHA-256'/, 'the check must actually hash');
  /*
   * The rule is that the bytes come out of the PAGE, not out of the record
   * they are being checked against. This used to assert the exact selector
   * `a[data-xbar-file]`, which stopped being the right one: that attribute is
   * ordinary HTML an alterer controls, so selecting by it checked only the
   * links the alterer chose to mark. Pinning the selector would have made the
   * assertion demand the bug back.
   */
  assert.match(script, /document\.querySelectorAll\('a'\)/, 'every link in the packet must be examined');
  assert.match(
    script,
    /link\.getAttribute\('href'\)/,
    'the files must be read out of the page, not taken from the record they are being checked against',
  );
  assert.match(
    script,
    /is not the one that was sealed/,
    'a swapped attachment must be reported, which is the attack the seal exists to catch',
  );
  assert.match(
    script,
    /was sealed but is missing from this packet/,
    'a removed attachment must be reported too — dropping the inconvenient file is the cheaper forgery',
  );

  /*
   * The facts are read back OUT of the sealed record. Everything printed above
   * the seal — the ask price, the transfer status, even the "Sealed facts"
   * list — is ordinary editable HTML, and editing it alone leaves the digest
   * intact. Printing what the digest actually covers is what makes that edit
   * visible to the buyer.
   */
  assert.match(script, /Every fact this seal covers, read out of the sealed record/);
  // Every field, walked generically. A curated list let an attacker edit any
  // fact that was not on it — breed, colour, owner entity, a document title —
  // while the digest still matched and the check still said pass.
  assert.match(script, /describe\(notes, parsed, ' {2}'\);/, 'the whole sealed payload must be rendered');
});

test('the packet no longer claims that reading the seal proves anything', async () => {
  const generator = await readFile('src/lib/localSalePacketGenerator.ts', 'utf8');

  /*
   * The old copy: "Compare this seal code with the one the seller gives you
   * directly: if they match, the packet is unaltered." False. The code is text
   * in the file; whoever swapped an attachment could leave it untouched, and
   * the buyer's comparison still matched.
   */
  assert.doesNotMatch(
    generator,
    /if they match, the packet is unaltered/,
    'the packet must not promise that comparing two printed strings proves anything',
  );
  assert.match(generator, /Reading the code above proves nothing by itself/);
  assert.match(
    generator,
    /this does not trust the button above/,
    'the by-hand route must be offered, because the in-page script is as editable as the rest of the file',
  );
  assert.match(generator, /shasum -a 256/, 'the by-hand steps must name a tool the buyer already has');
});

import { buildLocalSalePacket } from '../src/lib/localSalePacketGenerator.js';
import type { HorseRecord, OwnershipRecord, WorkspaceProfile } from '../src/types/xbar.js';

/* Minimal horse: the seal-code swap must hold on any rendered packet. */
function sealTestHorse(): HorseRecord {
  return {
    id: 'h-seal',
    name: 'Bella',
    barnName: 'Bella',
    breed: 'Quarter Horse',
    sex: 'Mare',
    color: 'Sorrel',
    foaledOn: '2018-05-01',
    registry: 'AQHA',
    registrationNumber: 'X7654321',
    microchipId: '985141000999999',
    owner: 'Erin Wyrick',
    status: 'Pasture',
    lastVetVisit: '2026-08-01',
    sale: { askPrice: 15000, listingState: 'Listed' },
    gallery: [],
    alerts: [],
  } as unknown as HorseRecord;
}

function sealTestOwnership(): OwnershipRecord {
  return {
    legalOwner: 'Rocking R Ranch LLC',
    transferStatus: 'Clear',
    pendingDocuments: [],
    complianceDeadline: '',
  } as unknown as OwnershipRecord;
}

const sealTestWorkspace = {
  ranchName: 'Rocking R Ranch',
  businessName: 'Rocking R Ranch LLC',
  defaultOwnerName: 'Erin Wyrick',
  operationsEmail: 'ranch@example.com',
} as unknown as WorkspaceProfile;

/*
 * The seal attributes the packet to the seller by name, never by workspace
 * role: when the byline is filtered (quick-start placeholder) or unset, the
 * sealedBy field stays empty rather than sealing the role ("Admin") the
 * wizard passes as generatedBy — a role is not a person, and sealing it
 * would contradict the byline the packet omits.
 */
test('a filtered or unset seller identity leaves sealedBy empty, never a role', () => {
  const quickStartWorkspace = {
    ranchName: 'Main Ranch',
    businessName: 'My Ranch LLC',
    defaultOwnerName: 'Main Ranch',
    ranchManagerName: 'Operations Lead',
    operationsEmail: 'owner@ranch.local',
  } as unknown as WorkspaceProfile;

  for (const workspaceProfile of [quickStartWorkspace, undefined]) {
    const packet = buildLocalSalePacket({
      horse: sealTestHorse(),
      workspaceProfile: workspaceProfile as WorkspaceProfile,
      documents: [],
      ownershipRecord: sealTestOwnership(),
      selectedDocumentIds: [],
      generatedBy: 'Admin',
      now: new Date('2026-09-24T12:00:00Z'),
    });
    assert.equal(
      JSON.parse(packet.credential.payload).sealedBy,
      '',
      'sealedBy must not carry the workspace role when there is no real seller identity',
    );
  }

  // A real identity still seals by name.
  const realPacket = buildLocalSalePacket({
    horse: sealTestHorse(),
    workspaceProfile: sealTestWorkspace,
    documents: [],
    ownershipRecord: sealTestOwnership(),
    selectedDocumentIds: [],
    generatedBy: 'Admin',
    now: new Date('2026-09-24T12:00:00Z'),
  });
  assert.ok(
    JSON.parse(realPacket.credential.payload).sealedBy.includes('Erin Wyrick'),
    'a real seller identity is still attributed',
  );
});

/* The seal and the page resolve the seller contact block from ONE profile.
 *
 * `buildLocalSalePacket` once called `buildPacketCredential` without
 * `workspaceProfile`, so the seal covered blank name/ranch/email while the
 * page printed the real contact block — a buyer could edit the visible seller
 * details without changing the digest. Direct `buildSaleCredential` tests
 * cannot catch that wiring gap: only an end-to-end packet can, so this test
 * compares the rendered contact block with the sealed record.
 */
test('the sealed seller block is the contact block the packet renders', () => {
  const horse = {
    ...sealTestHorse(),
    profileImage: 'https://photos.test/bella-hero.jpg',
    gallery: [
      { id: 'g-hero', label: 'Hero', kind: 'Hero', url: 'https://photos.test/bella-hero.jpg', status: 'Approved' },
    ],
  } as unknown as HorseRecord;

  const packet = buildLocalSalePacket({
    horse,
    workspaceProfile: sealTestWorkspace,
    documents: [],
    ownershipRecord: sealTestOwnership(),
    selectedDocumentIds: [],
    generatedBy: 'Ranch Manager',
    now: new Date('2026-09-24T12:00:00Z'),
  });

  const sealed = JSON.parse(packet.credential.payload).seller as {
    name: string;
    ranch: string;
    email: string;
    heroPhotoUrl: string;
  };
  // The profile values the page prints are the ones the seal covers.
  assert.equal(sealed.name, 'Erin Wyrick');
  assert.equal(sealed.ranch, 'Rocking R Ranch');
  assert.equal(sealed.email, 'ranch@example.com');
  assert.equal(sealed.heroPhotoUrl, 'https://photos.test/bella-hero.jpg');
  // ...and the page prints exactly those values, including the sealed photo.
  assert.ok(packet.html.includes('Erin Wyrick'), 'rendered seller name');
  assert.ok(packet.html.includes('Rocking R Ranch'), 'rendered ranch');
  assert.ok(packet.html.includes('ranch@example.com'), 'rendered email');
  assert.ok(packet.html.includes('src="https://photos.test/bella-hero.jpg"'), 'rendered hero photo');
});

/*
 * The verifier has to FIND the contact block to bind it. #252 sealed the
 * seller's name, ranch and email, but the verifier compared only the hero
 * photo, so a packet altered to show another email still read "matches the
 * seal" — the buyer's reply, and the payment talk that follows it, going to
 * whoever edited the page. Each sealed field is printed in a cell the verifier
 * names, and the byline in a span it names; this pins that those carry exactly
 * the sealed values, so the verifier compares against the right text.
 */
test('each sealed seller field is printed where the verifier can compare it', () => {
  const build = (workspaceProfile: WorkspaceProfile) =>
    buildLocalSalePacket({
      horse: sealTestHorse(),
      workspaceProfile,
      documents: [],
      ownershipRecord: sealTestOwnership(),
      selectedDocumentIds: [],
      generatedBy: 'Ranch Manager',
      now: new Date('2026-09-24T12:00:00Z'),
    });
  const packet = build(sealTestWorkspace);
  const payload = JSON.parse(packet.credential.payload) as {
    sealedBy: string;
    seller: { name: string; ranch: string; email: string };
  };
  const cells = Object.fromEntries(
    [...packet.html.matchAll(/<td id="xbar-seller-(name|ranch|email)">([^<]*)<\/td>/g)].map((m) => [m[1], m[2]]),
  );
  assert.deepEqual(cells, { name: payload.seller.name, ranch: payload.seller.ranch, email: payload.seller.email });
  assert.equal(packet.html.match(/id="xbar-seller-contact"/g)?.length, 1, 'one contact table, named');
  assert.ok(packet.html.includes('<div class="meta" id="xbar-packet-meta">'), 'the byline sits in the named meta line');
  assert.ok(payload.sealedBy, 'the fixture has a byline to bind');
  assert.equal(
    /<span id="xbar-seller-byline">([^<]*)<\/span>/.exec(packet.html)?.[1],
    `Prepared by ${payload.sealedBy}`,
  );
  // A field that was not sealed is not printed, so "shown but not sealed" stays a real alteration.
  const noEmail = build({ ...sealTestWorkspace, operationsEmail: '' } as WorkspaceProfile);
  assert.equal(JSON.parse(noEmail.credential.payload).seller.email, '');
  assert.ok(!noEmail.html.includes('xbar-seller-email'), 'an unsealed email has no cell');
});

/* The quick-start placeholders are not seller contact details.
 *
 * handleQuickStart invents `Main Ranch` (as the ranch name —
 * applyWorkspaceProfileDefaults then derives defaultOwnerName from it, so
 * it also arrives as the seller name), `Operations Lead` and
 * `owner@ranch.local` so a skipped setup yields a working ranch. Resolving
 * them as real contact details would seal — and print on the buyer packet —
 * an invented ranch, person and mailbox as authenticated contact
 * information. The seller block degrades to an honest absence instead.
 */
test('quick-start placeholder contact is excluded from the sealed seller block', () => {
  const quickStartProfile = {
    ...sealTestWorkspace,
    defaultOwnerName: 'Main Ranch',
    ranchName: 'Main Ranch',
    ranchManagerName: 'Operations Lead',
    operationsEmail: 'owner@ranch.local',
  } as unknown as WorkspaceProfile;

  const packet = buildLocalSalePacket({
    horse: sealTestHorse(),
    workspaceProfile: quickStartProfile,
    documents: [],
    ownershipRecord: sealTestOwnership(),
    selectedDocumentIds: [],
    generatedBy: 'Ranch Manager',
    now: new Date('2026-09-24T12:00:00Z'),
  });

  const sealed = JSON.parse(packet.credential.payload).seller as {
    name: string;
    ranch: string;
    email: string;
  };
  assert.equal(sealed.name, '', 'the invented ranch name must not be sealed as the seller');
  assert.equal(sealed.ranch, '', 'the invented ranch name must not be sealed as the ranch');
  assert.equal(sealed.email, '', 'the invented mailbox must not be sealed');
  assert.ok(!packet.html.includes('owner@ranch.local'), 'the invented mailbox must not be printed');
  assert.ok(!packet.html.includes('Operations Lead'), 'the invented manager name must not be printed');
  assert.ok(!packet.html.includes('Main Ranch'), 'the invented ranch name must not be printed');
});

/*
 * M14: the by-hand verification steps used to print a literal example,
 * `SEAL-XXXX-XXXX-XXXX`, as the seal code. A buyer following the steps would
 * compare their recomputed hash against a placeholder that can never match —
 * or worse, read it as the format and accept any SEAL-looking string. The
 * steps now print this packet's own seal code.
 */
test("the by-hand seal check prints this packet's seal code, not an example", () => {
  const packet = buildLocalSalePacket({
    horse: sealTestHorse(),
    workspaceProfile: sealTestWorkspace,
    documents: [],
    ownershipRecord: sealTestOwnership(),
    selectedDocumentIds: [],
    generatedBy: 'Ranch Manager',
    now: new Date('2026-09-24T12:00:00Z'),
  });

  const printed = packet.html.match(/<div class="seal__code">([^<]+)<\/div>/)?.[1];
  assert.ok(printed && /^SEAL-[0-9A-Z-]+$/.test(printed), 'the packet prints a real seal code');
  assert.ok(!packet.html.includes('SEAL-XXXX-XXXX-XXXX'), 'the example placeholder must not ship in a packet');
  assert.ok(
    packet.html.includes(`are the seal code for this packet: <code>${printed}</code>`),
    'the by-hand step must name this packet\u2019s own seal code',
  );
});

/*
 * The share sheet caption travels under the seller's name, not just the
 * platform's: "{Ranch}: sale packet for Bella verified by XBAR…".
 * `buildShareText` grew an optional ranch param for this; the wizard must
 * pass it — filtered through realWorkspaceName, so a quick-start
 * placeholder (My Ranch LLC, Main Ranch) is never presented as the seller.
 */
test('the wizard share caption names the ranch', async () => {
  const source = await readFile('src/components/SalePacketWizard.tsx', 'utf8');
  assert.match(
    source,
    /buildShareText\(\s*horse\?\.name \?\? '',\s*sealCode,\s*realWorkspaceName\(workspaceProfile\.businessName\) \|\| realWorkspaceName\(workspaceProfile\.ranchName\),?\s*\)/,
    'the wizard must pass the sentinel-filtered ranch name as the share text’s third argument',
  );
});
