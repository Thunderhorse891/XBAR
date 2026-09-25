import { expect, test, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { buildLocalSalePacket } from '../../src/lib/localSalePacketGenerator.js';
import type { HorseRecord, OwnershipRecord, WorkspaceProfile } from '../../src/types/xbar.js';

// Exercise the exported file with Chromium's actual parser and DOM. The Node
// attack harness cannot model HTMLCollection vs childNodes, table foster
// parenting, collapsed details, or visible input values on its own.
function packet({ photo = true, seller = true, escaped = false, unnamed = false } = {}) {
  const horse = {
    id: 'browser-seal-horse',
    name: unnamed ? '' : escaped ? 'Bella & "Blue" <Star>' : 'Bella',
    barnName: 'Bella',
    breed: 'Quarter Horse',
    sex: 'Mare',
    color: 'Sorrel',
    foaledOn: '2018-05-01',
    registry: 'AQHA',
    registrationNumber: 'TEST-123',
    microchipId: '985141000999999',
    owner: 'Test Seller',
    status: 'Pasture',
    lastVetVisit: '2026-08-01',
    sale: { askPrice: 15000, listingState: 'Listed' },
    profileImage: photo ? 'https://photos.test/hero.png' : '',
    gallery: photo
      ? [{ id: 'hero', label: 'Hero', kind: 'Hero', url: 'https://photos.test/hero.png', status: 'Approved' }]
      : [],
    alerts: [],
  } as unknown as HorseRecord;
  return buildLocalSalePacket({
    horse,
    workspaceProfile: {
      ranchName: seller ? (escaped ? 'Rock & <River>' : 'Test Ranch') : '',
      businessName: '',
      defaultOwnerName: seller ? (escaped ? 'Jo "J" & Lee' : 'Test Seller') : '',
      operationsEmail: seller ? 'ranch@example.com' : '',
    } as WorkspaceProfile,
    ownershipRecord: {
      legalOwner: 'Test Seller',
      transferStatus: 'Clear',
      pendingDocuments: [],
      complianceDeadline: '',
    } as unknown as OwnershipRecord,
    documents: [],
    selectedDocumentIds: [],
    generatedBy: 'Admin',
    now: new Date('2026-09-24T12:00:00Z'),
  });
}

async function openPacket(page: Page, html: string, path: string) {
  // Only synthetic packet content is loaded. The hero bytes are incidental to
  // this source-address seal; keep the tests independent of an external host.
  await page.route('https://photos.test/**', (route) => route.abort());
  await writeFile(path, html, 'utf8');
  await page.goto(pathToFileURL(path).href);
  await expect(page.locator('#xbar-verify-btn')).toBeVisible();
}

async function expectVerdict(page: Page, state: 'pass' | 'fail') {
  await page.locator('#xbar-verify-btn').click();
  await expect(page.locator('#xbar-verify-out')).toHaveAttribute('data-state', state);
  await expect(page.locator('#xbar-verify-out')).toBeVisible();
}

for (const fixture of [
  { name: 'seller and photo', photo: true, seller: true },
  { name: 'seller without photo', photo: false, seller: true },
  { name: 'photo without seller', photo: true, seller: false },
  { name: 'neither photo nor seller', photo: false, seller: false },
  { name: 'escaped seller and horse names', photo: true, seller: true, escaped: true },
  { name: 'unnamed horse fallback', photo: true, seller: true, unnamed: true },
]) {
  test(`honest exported packet verifies: ${fixture.name}`, async ({ page }, testInfo) => {
    const original = packet(fixture);
    await openPacket(page, original.html, testInfo.outputPath('packet.html'));
    await expect(page.locator('#xbar-credential-payload')).toHaveText(original.credential.payload);
    await expectVerdict(page, 'pass');
  });
}

for (const selector of ['.content > header > h1', '.content > header > .eyebrow']) {
  test(`rejects nested visible instructions over hidden header text in ${selector}`, async ({ page }, testInfo) => {
    const original = packet();
    await openPacket(page, original.html, testInfo.outputPath('packet.html'));
    await page.locator(selector).evaluate((node) => {
      const hidden = document.createElement('span');
      hidden.hidden = true;
      hidden.textContent = node.textContent;
      const input = document.createElement('input');
      input.value = 'PAYMENT EMAIL: attacker@example.com';
      node.replaceChildren(input, hidden);
    });
    await expect(page.locator(selector).locator('input')).toBeVisible();
    await expectVerdict(page, 'fail');
  });

  test(`rejects concealing attributes on ${selector}`, async ({ page }, testInfo) => {
    const original = packet();
    await openPacket(page, original.html, testInfo.outputPath('packet.html'));
    await page.locator(selector).evaluate((node) => node.setAttribute('hidden', ''));
    await expectVerdict(page, 'fail');
  });
}

const substitutions = [
  ['seller name', '#xbar-seller-name'],
  ['ranch', '#xbar-seller-ranch'],
  ['seller email', '#xbar-seller-email'],
  ['byline', '#xbar-seller-byline'],
  ['generated stamp', '#xbar-packet-meta > span:first-child'],
  ['horse heading', '.content > header > h1'],
  ['eyebrow', '.content > header > .eyebrow'],
  ['contact heading', '#xbar-seller-contact >> xpath=../h2'],
] as const;

for (const [name, selector] of substitutions) {
  test(`rejects a substituted ${name} with the original seal`, async ({ page }, testInfo) => {
    const original = packet();
    await openPacket(page, original.html, testInfo.outputPath('packet.html'));
    const script = await page.locator('body > script').textContent();
    await page.locator(selector).evaluate((node) => {
      node.textContent = 'PAYMENT EMAIL: attacker@example.com';
    });
    await expect(page.locator(selector)).toBeVisible();
    await expect(page.locator('#xbar-credential-payload')).toHaveText(original.credential.payload);
    expect(await page.locator('body > script').textContent()).toBe(script);
    await expectVerdict(page, 'fail');
  });
}

for (const selector of ['.content', '.content > header', '#xbar-packet-meta', '#xbar-seller-contact >> xpath=..']) {
  test(`rejects a bare payment instruction in ${selector}`, async ({ page }, testInfo) => {
    const original = packet();
    await openPacket(page, original.html, testInfo.outputPath('packet.html'));
    await page.locator(selector).evaluate((node) => {
      node.prepend(document.createTextNode('UPDATED PAYMENT EMAIL: attacker@example.com'));
    });
    await expect(page.locator('#xbar-credential-payload')).toHaveText(original.credential.payload);
    await expectVerdict(page, 'fail');
  });
}

test('rejects table text moved into the contact section by the HTML parser', async ({ page }, testInfo) => {
  const original = packet();
  const html = original.html.replace(
    '<table id="xbar-seller-contact">',
    '<table id="xbar-seller-contact">UPDATED PAYMENT EMAIL: attacker@example.com',
  );
  expect(html).not.toBe(original.html);
  await openPacket(page, html, testInfo.outputPath('packet.html'));
  // This is Chromium's foster-parenting result, not a hand-built DOM fixture.
  expect(
    await page
      .locator('#xbar-seller-contact')
      .evaluate((table) =>
        Array.from(table.parentNode!.childNodes).some(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes('UPDATED PAYMENT EMAIL'),
        ),
      ),
  ).toBe(true);
  await expect(page.locator('#xbar-credential-payload')).toHaveText(original.credential.payload);
  await expectVerdict(page, 'fail');
});

test('allows whitespace reserialization between generated elements', async ({ page }, testInfo) => {
  const original = packet();
  const html = original.html.replace(/(<section><h2>Contact the seller<\/h2>.*?<\/section>)/, (section) =>
    section.replace(/></g, '>\n  <'),
  );
  expect(html).not.toBe(original.html);
  await openPacket(page, html, testInfo.outputPath('packet.html'));
  await expectVerdict(page, 'pass');
});

test('rejects visible input over a hidden copy of the sealed email', async ({ page }, testInfo) => {
  const original = packet();
  await openPacket(page, original.html, testInfo.outputPath('packet.html'));
  await page.locator('#xbar-seller-email').evaluate((cell) => {
    cell.innerHTML = '<input value="attacker@example.com"><span hidden>ranch@example.com</span>';
  });
  await expect(page.locator('#xbar-seller-email input')).toBeVisible();
  await expect(page.locator('#xbar-seller-email input')).toHaveValue('attacker@example.com');
  expect(await page.locator('#xbar-seller-email').textContent()).toBe('ranch@example.com');
  await expectVerdict(page, 'fail');
});

test('rejects the genuine email marker hidden behind a visible replacement', async ({ page }, testInfo) => {
  const original = packet();
  await openPacket(page, original.html, testInfo.outputPath('packet.html'));
  await page.locator('#xbar-seller-email').evaluate((cell) => {
    const genuine = cell.cloneNode(true);
    cell.removeAttribute('id');
    cell.textContent = 'attacker@example.com';
    document.querySelector('.verify__manual')!.append(genuine);
  });
  await expect(page.locator('#xbar-seller-email')).not.toBeVisible();
  await expectVerdict(page, 'fail');
});

test('rejects a concealed genuine header behind a forged header', async ({ page }, testInfo) => {
  const original = packet();
  await openPacket(page, original.html, testInfo.outputPath('packet.html'));
  await page.locator('.content > header').evaluate((header) => {
    const forged = document.createElement('header');
    forged.textContent = 'Prepared by attacker@example.com';
    header.replaceWith(forged);
    document.querySelector('.verify__manual')!.append(header);
  });
  await expect(page.locator('#xbar-seller-byline')).not.toBeVisible();
  await expectVerdict(page, 'fail');
});

for (const seller of [true, false]) {
  test(`rejects a hidden hero replaced by payment instructions (seller=${seller})`, async ({ page }, testInfo) => {
    const original = packet({ seller });
    await openPacket(page, original.html, testInfo.outputPath('packet.html'));
    await page.locator('section > img').evaluate((hero) => {
      const forged = document.createElement('p');
      forged.textContent = 'Wire to attacker account';
      hero.replaceWith(forged);
      document.querySelector('.verify__manual')!.append(hero);
    });
    await expect(page.getByText('Wire to attacker account', { exact: true })).toBeVisible();
    await expectVerdict(page, 'fail');
  });
}

test('rejects a hidden sealed byline', async ({ page }, testInfo) => {
  const original = packet();
  await openPacket(page, original.html, testInfo.outputPath('packet.html'));
  await page.locator('#xbar-seller-byline').evaluate((byline) => byline.setAttribute('hidden', ''));
  await expect(page.locator('#xbar-seller-byline')).not.toBeVisible();
  await expectVerdict(page, 'fail');
});
