import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream, PDFString } from 'pdf-lib';
import type { DocumentRecord } from '../../src/types/xbar.js';

async function settleDeviceWrite(page: Page) {
  expect(
    await page.evaluate(async () => {
      const module = '/src/lib/workspaceStorage.ts';
      const receipt = (await import(/* @vite-ignore */ module)).getWorkspacePersistReceipt();
      return receipt ? await receipt.completed : false;
    }),
  ).toBe(true);
}

// Deliberately synthetic original PDFs and source-review attestations. The test
// does not claim a registry/vet review, hosted signup or paid checkout occurred.
async function reviewedOriginals(page: Page) {
  const specs = [
    ['bill_of_sale', 'Bill of Sale', 'Synthetic bill of sale', 'Bill of sale. Buyer signature.'],
    ['registration_certificate', 'Registration', 'Synthetic registration', 'Certificate of registration.'],
    ['transfer_form', 'Transfer Packet', 'Synthetic transfer', 'Transfer of ownership. Buyer signature.'],
    ['signature_page', 'Ownership Memo', 'Synthetic signature page', 'Ownership memo. Seller signature.'],
  ];
  const sources = [];
  for (const [kind, type, title, text] of specs) {
    const pdf = await PDFDocument.create();
    const content = `SYNTHETIC QA ONLY - NOT LEGAL PROOF\n${text}\nRegistered Name: COPPER CREEK FICTIONAL\nRegistration Number: SYNTHETIC-100`;
    pdf.addPage().drawText(content, { x: 48, y: 700, size: 11, lineHeight: 18 });
    sources.push({ kind, type, title, text: content, bytes: Array.from(await pdf.save()) });
  }
  await page.evaluate(async (sources) => {
    const storeModule = '/src/store/useXbarStore.ts',
      vaultModule = '/src/lib/localFileVault.ts',
      reviewModule = '/src/lib/ownershipDocumentReview.ts';
    const { useXbarStore } = await import(/* @vite-ignore */ storeModule);
    const { storeLocalFile } = await import(/* @vite-ignore */ vaultModule);
    const { ownershipDocumentReviewKey } = await import(/* @vite-ignore */ reviewModule);
    const state = useXbarStore.getState(),
      horse = state.horses[0],
      now = new Date().toISOString();
    const documents: DocumentRecord[] = [];
    for (const source of sources) {
      const fileName = `${source.kind}-synthetic.pdf`;
      const localFileKey = await storeLocalFile(
        new Blob([new Uint8Array(source.bytes)], { type: 'application/pdf' }),
        fileName,
        'application/pdf',
        'local',
      );
      documents.push({
        id: `qa-${source.kind}`,
        horseId: horse.id,
        title: source.title,
        type: source.type as DocumentRecord['type'],
        state: 'Ready',
        source: 'Manual Upload',
        uploadedAt: now,
        uploadedBy: 'Synthetic reviewer',
        confidence: 1,
        duplicateRisk: 'Low',
        entities: { horseName: horse.name, registrationNumber: horse.registrationNumber },
        extractedTextPreview: source.text,
        summary: 'SYNTHETIC QA ONLY',
        localFileKey,
        fileName,
        mimeType: 'application/pdf',
      });
    }
    useXbarStore.setState({
      documents: [
        ...documents,
        {
          id: 'private',
          horseId: horse.id,
          title: 'PRIVATE_NEGOTIATION_SENTINEL',
          type: 'Breeding Contract',
          state: 'Ready',
          source: 'Manual Upload',
          uploadedAt: now,
          uploadedBy: 'Synthetic reviewer',
          confidence: 1,
          duplicateRisk: 'Low',
          entities: {},
          extractedTextPreview: 'PRIVATE_NEGOTIATION_SENTINEL',
          summary: 'PRIVATE_NEGOTIATION_SENTINEL',
        },
      ],
      horses: [
        {
          ...horse,
          costBasis: 8250,
          medicalNotes: 'PRIVATE_MEDICAL_SENTINEL',
          documents: documents.map((doc) => doc.id),
          sale: { ...horse.sale, askPrice: 18500, listingState: 'Market Ready' },
        },
      ],
      expenseReceipts: [
        { id: 'overhead', category: 'Feed', amount: 900, receiptDate: now.slice(0, 10) },
        { id: 'unmatched', horseId: 'absent', category: 'Feed', amount: 200, receiptDate: now.slice(0, 10) },
      ],
      ownershipRecords: [
        {
          id: 'synthetic-ownership',
          horseId: horse.id,
          legalOwner: 'Fictional Creek LLC',
          transferStatus: 'Clear',
          pendingDocuments: [],
          confidence: 100,
          complianceDeadline: '',
          auditTrail: [],
          proofRequirements: sources.map((source) => ({
            id: `proof-${source.kind}`,
            kind: source.kind,
            label: source.title,
            status: 'verified',
            documentId: `qa-${source.kind}`,
            verifiedBy: 'Synthetic reviewer',
            verifiedAt: now,
            reviewAttestedAt: now,
            reviewedSourceKey: ownershipDocumentReviewKey(documents.find((doc) => doc.id === `qa-${source.kind}`)),
          })),
        },
      ],
    });
  }, sources);
  await settleDeviceWrite(page);
  return sources;
}

function embeddedFiles(pdf: PDFDocument) {
  const names = pdf.catalog
    .lookup(PDFName.of('Names'), PDFDict)
    .lookup(PDFName.of('EmbeddedFiles'), PDFDict)
    .lookup(PDFName.of('Names'), PDFArray);
  const result = new Map<string, Buffer>();
  for (let index = 0; index < names.size(); index += 2) {
    const name = (names.lookup(index) as PDFString).decodeText();
    const file = names
      .lookup(index + 1, PDFDict)
      .lookup(PDFName.of('EF'), PDFDict)
      .lookup(PDFName.of('F')) as PDFRawStream;
    result.set(
      name,
      Buffer.from(
        file.dict.get(PDFName.of('Filter'))?.toString() === '/FlateDecode' ? inflateSync(file.contents) : file.contents,
      ),
    );
  }
  return result;
}

for (const width of [390, 1440]) {
  test(`Documents saves fields, retains a repair draft, and retrieves actual PDFs after reload at ${width}px`, async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await context.route('**/*', (route) =>
      ['127.0.0.1', ''].includes(new URL(route.request().url()).hostname) || route.request().url().startsWith('blob:')
        ? route.continue()
        : route.abort(),
    );
    await page.goto('/app/login');
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await page.getByPlaceholder('XBAR LLC').fill('Fictional Creek LLC');
    await page.getByPlaceholder('Primary Ranch').fill('Fictional Creek Ranch');
    await page.getByRole('button', { name: 'Create workspace', exact: true }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.goto('/app/documents');
    await page.getByRole('button', { name: 'Add a horse', exact: true }).click();
    let drawer = page.getByRole('dialog', { name: 'Add Horse' });
    await drawer.getByPlaceholder('e.g. THR Copper Canyon').fill('Copper Creek Fictional');
    await drawer.getByRole('button', { name: 'Add Horse', exact: true }).click();
    await expect(drawer).toContainText('Choose a record group before adding the horse.');
    await expect(drawer.getByPlaceholder('e.g. THR Copper Canyon')).toHaveValue('Copper Creek Fictional');
    await drawer.getByLabel('Segment', { exact: true }).selectOption('Sale Prospect');
    await drawer.getByRole('button', { name: 'Add Horse', exact: true }).click();
    await expect(drawer).toContainText("Choose the horse's sex before adding the horse.");
    await drawer.getByLabel('Sex', { exact: true }).selectOption('Gelding');
    await drawer.getByRole('button', { name: 'Add Horse', exact: true }).click();
    await expect(page).toHaveURL(/\/horses\//);
    const horseId = new URL(page.url()).pathname.split('/').at(-1)!;
    const documentsUrl = `/app/documents?horse=${encodeURIComponent(horseId)}&stage=Library`;
    await page.goto(documentsUrl);
    await page.getByRole('button', { name: 'Edit horse fields', exact: true }).click();
    drawer = page.getByRole('dialog', { name: 'Edit Horse' });
    for (const [label, value] of [
      ['Breed', 'Quarter Horse'],
      ['Color', 'Sorrel'],
      ['Registry', 'Fictional registry'],
      ['Registration number', 'SYNTHETIC-100'],
      ['Barn name', 'Copper'],
    ])
      await drawer.getByLabel(label, { exact: true }).fill(value);
    await drawer.getByRole('button', { name: 'Save changes', exact: true }).click();
    await expect(drawer).toBeHidden();
    await page.reload();
    const saved = await page.evaluate(async () => {
      const module = '/src/store/useXbarStore.ts';
      const horse = (await import(/* @vite-ignore */ module)).useXbarStore.getState().horses[0];
      return {
        id: horse.id,
        color: horse.color,
        breed: horse.breed,
        sex: horse.sex,
        registration: horse.registrationNumber,
      };
    });
    expect(saved).toEqual({
      id: horseId,
      color: 'Sorrel',
      breed: 'Quarter Horse',
      sex: 'Gelding',
      registration: 'SYNTHETIC-100',
    });

    await page.goto('/app/billing');
    await expect(page.getByRole('article', { name: 'Free plan', exact: true })).toContainText('No card required');
    await page
      .getByRole('button', { name: /^Start 14-day/ })
      .first()
      .click();
    expect(
      await page.evaluate(async () => {
        const module = '/src/store/useXbarStore.ts';
        return (await import(/* @vite-ignore */ module)).useXbarStore.getState().subscription.tier;
      }),
    ).toBe('Professional');
    const sources = await reviewedOriginals(page);
    await page.goto(documentsUrl);
    await expect(page.getByRole('button', { name: 'Prepare buyer packet', exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(page.getByText('Synthetic bill of sale', { exact: true }).first()).toBeVisible();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath(`documents-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Prepare buyer packet', exact: true }).click();
    const wizard = page.getByRole('dialog', { name: 'Sale packet generator' });
    await wizard.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(wizard.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled();
    await wizard.getByRole('checkbox', { name: /No current Coggins/ }).check();
    await wizard.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(wizard.getByText('PRIVATE_NEGOTIATION_SENTINEL', { exact: true })).toHaveCount(0);
    await expect(wizard.getByRole('checkbox')).toHaveCount(4);
    await wizard.getByRole('checkbox').last().uncheck();
    await wizard.getByRole('button', { name: 'Continue', exact: true }).click();
    await wizard.getByRole('textbox', { name: 'Buyer name', exact: true }).fill('Fictional Buyer');
    await wizard.getByRole('textbox', { name: 'Buyer email', exact: true }).fill('buyer@example.test');
    await wizard.getByRole('textbox', { name: 'Watermark', exact: true }).fill('SYNTHETIC BUYER REVIEW');
    await wizard.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(wizard.locator('.packet-preview')).toContainText('3 selected approved records');
    await expect(wizard.locator('.packet-preview')).toContainText('No ranch logo saved');
    await page.screenshot({ path: testInfo.outputPath(`preview-fallback-${width}.png`) });
    await wizard.getByRole('button', { name: 'Edit ranch branding', exact: true }).click();
    // Existing supplied XBAR artwork selected as the fixture's workspace logo.
    await page.getByLabel('Ranch logo', { exact: true }).setInputFiles('public/brand/xbar-original-lockup-480.png');
    await page.getByRole('button', { name: 'Save profile', exact: true }).click();
    await expect(page.getByText('Profile saved on this device', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Return to packet', exact: true }).click();
    await wizard.getByRole('checkbox', { name: /No current Coggins/ }).check();
    await wizard.getByRole('button', { name: 'Continue', exact: true }).click();
    await wizard.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(wizard.getByRole('textbox', { name: 'Buyer name', exact: true })).toHaveValue('Fictional Buyer');
    await wizard.getByRole('button', { name: 'Continue', exact: true }).click();
    await expect(wizard.getByAltText('Saved ranch logo')).toBeVisible();
    await expect(wizard.locator('.packet-preview')).toContainText('3 selected approved records');
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 15000 });
    await page.screenshot({ path: testInfo.outputPath(`preview-logo-${width}.png`) });
    await wizard.getByRole('button', { name: 'Generate sale packet', exact: true }).click();
    await expect(wizard.getByRole('button', { name: 'Download packet PDF', exact: true })).toBeVisible({
      timeout: 30000,
    });
    const downloadPromise = page.waitForEvent('download');
    await wizard.getByRole('button', { name: 'Download packet PDF', exact: true }).click();
    const download = await downloadPromise;
    const packetPath = testInfo.outputPath(`buyer-packet-${width}.pdf`);
    await download.saveAs(packetPath);
    const bytes = await readFile(packetPath),
      pdf = await PDFDocument.load(bytes),
      files = embeddedFiles(pdf);
    expect(pdf.getPageCount()).toBeGreaterThanOrEqual(4);
    expect(files.size).toBe(4);
    const html = files.get('copper-creek-fictional-xbar-buyer-sale-packet.html')!.toString();
    expect(html).not.toContain('PRIVATE_NEGOTIATION_SENTINEL');
    expect(html).not.toContain('PRIVATE_MEDICAL_SENTINEL');
    for (const [index, source] of sources.slice(0, 3).entries())
      expect(files.get(`${index + 1}-${source.kind}-synthetic.pdf`)).toEqual(Buffer.from(source.bytes));
    const packetPage = await context.newPage();
    const packetUrl = await page.evaluate((html) => URL.createObjectURL(new Blob([html], { type: 'text/html' })), html);
    await packetPage.goto(packetUrl);
    await packetPage.locator('#xbar-verify-btn').click();
    await expect(packetPage.locator('#xbar-verify-out')).toHaveAttribute('data-state', 'pass');
    await packetPage.close();
    await page.evaluate((url) => URL.revokeObjectURL(url), packetUrl);
    await wizard.locator('.confirm-dialog__cancel').filter({ hasText: 'Close' }).click();
    await settleDeviceWrite(page);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sale Packets', exact: true })).toBeVisible();
    const savedRow = page.locator('.sale-packet-row').filter({
      has: page.getByRole('button', { name: 'Download saved packet', exact: true }),
    });
    expect((await savedRow.locator('.xs-mrow__main').boundingBox())!.width).toBeGreaterThanOrEqual(
      Math.min(300, width * 0.6),
    );
    if (width === 390)
      expect(
        (await savedRow.getByRole('button', { name: 'Download saved packet', exact: true }).boundingBox())!.height,
      ).toBeGreaterThanOrEqual(44);
    const savedDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download saved packet', exact: true }).click();
    const savedDownload = await savedDownloadPromise;
    const reopened = testInfo.outputPath(`reopened-buyer-packet-${width}.pdf`);
    await savedDownload.saveAs(reopened);
    expect(await readFile(reopened)).toEqual(bytes);
    await page.goto(documentsUrl);
    await page.getByRole('button', { name: 'Ranch report', exact: true }).click();
    const reportDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export PDF|Download PDF/i }).click();
    const reportDownload = await reportDownloadPromise;
    const reportPath = testInfo.outputPath(`ranch-report-${width}.pdf`);
    await reportDownload.saveAs(reportPath);
    expect((await PDFDocument.load(await readFile(reportPath))).getPageCount()).toBeGreaterThanOrEqual(3);
    await expect(page.getByText('Reconcile your capital', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`reports-${width}.png`), fullPage: true });
    await page.reload();
    expect(
      await page.evaluate(async () => {
        const module = '/src/store/useXbarStore.ts';
        const state = (await import(/* @vite-ignore */ module)).useXbarStore.getState();
        return {
          horseId: state.horses[0].id,
          color: state.horses[0].color,
          logo: Boolean(state.workspaceProfile.packetLogoDataUrl),
          buyer: state.salePacketBuilds.at(-1)?.buyerName,
          selected: state.salePacketBuilds.at(-1)?.documentIds.length,
        };
      }),
    ).toEqual({ horseId, color: 'Sorrel', logo: true, buyer: 'Fictional Buyer', selected: 3 });
    // Simulate loss of this test workspace's generated file only. The saved
    // packet row must survive and explain the failed retrieval honestly.
    await page.evaluate(async () => {
      const storeModule = '/src/store/useXbarStore.ts',
        vaultModule = '/src/lib/localFileVault.ts';
      const state = (await import(/* @vite-ignore */ storeModule)).useXbarStore.getState();
      const key = state.salePacketBuilds.at(-1)?.localFileKey;
      if (!key) throw new Error('Synthetic packet is missing its saved file key');
      await (await import(/* @vite-ignore */ vaultModule)).deleteLocalFile(key);
    });
    await page.goto('/app/sale-packets');
    await page.reload();
    const unexpectedDownloads: string[] = [];
    page.on('download', (file) => unexpectedDownloads.push(file.suggestedFilename()));
    await page.getByRole('button', { name: 'Download saved packet', exact: true }).click();
    await expect(page.getByText('Packet was not downloaded', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Download saved packet', exact: true })).toBeEnabled();
    expect(unexpectedDownloads).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`retrieval-failure-${width}.png`) });
  });
}
