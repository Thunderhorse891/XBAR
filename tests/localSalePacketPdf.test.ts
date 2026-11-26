import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRawStream } from 'pdf-lib';
import { renderLocalSalePacketPdf } from '../src/lib/localSalePacketPdf.js';
import { buildLocalSalePacket } from '../src/lib/localSalePacketGenerator.js';
import type { HorseRecord, WorkspaceProfile } from '../src/types/xbar.js';

const horse = {
  id: 'synthetic',
  name: 'Synthetic Copper',
  breed: 'Quarter Horse',
  sex: 'Gelding',
  color: 'Sorrel',
  status: 'Pasture',
  sale: { askPrice: 18500, listingState: 'Market Ready' },
  owner: 'Fictional Ranch',
  costBasis: 8000,
  medicalNotes: 'PRIVATE_MEDICAL_SENTINEL',
  gallery: [],
  alerts: [],
} as unknown as HorseRecord;
const profile = {
  ranchName: 'Fictional Ranch',
  businessName: 'Fictional LLC',
  operationsEmail: 'ranch@example.test',
} as WorkspaceProfile;
const branding = async () => ({
  logo: await readFile('public/brand/xbar-report-horse.png'),
  mark: await readFile('public/brand/xbar-original-lockup-480.png'),
  watermark: await readFile('public/brand/xbar-report-watermark.png'),
});

test('saved buyer PDF retains readable source pages, exact originals and its interactive sealed copy', async () => {
  const source = await PDFDocument.create();
  source.addPage().drawText('SYNTHETIC REGISTRATION ORIGINAL');
  const original = await source.save();
  const attachments = [
    {
      id: 'original',
      label: 'Synthetic registration',
      fileName: 'registration.pdf',
      dataUrl: `data:application/pdf;base64,${Buffer.from(original).toString('base64')}`,
      sizeBytes: original.length,
    },
  ];
  const packet = buildLocalSalePacket({
    horse,
    workspaceProfile: profile,
    documents: [],
    selectedDocumentIds: [],
    generatedBy: 'Synthetic reviewer',
    attachments,
    watermark: 'SYNTHETIC BUYER',
    now: new Date('2026-11-26T12:00:00Z'),
  });
  const result = await renderLocalSalePacketPdf({
    packet,
    horse,
    profile,
    attachments,
    watermark: 'SYNTHETIC BUYER',
    branding: await branding(),
  });
  assert.match(result.fileName, /\.pdf$/);
  const pdf = await PDFDocument.load(result.bytes);
  assert.ok(pdf.getPageCount() >= 2, 'source page follows actual rendered cover pages');
  const files = pdf.catalog
    .lookup(PDFName.of('Names'), PDFDict)
    .lookup(PDFName.of('EmbeddedFiles'), PDFDict)
    .lookup(PDFName.of('Names'), PDFArray);
  assert.equal(files.size(), 4, 'one interactive HTML and one exact original');
  const extract = (index: number) => {
    const file = files.lookup(index, PDFDict).lookup(PDFName.of('EF'), PDFDict).lookup(PDFName.of('F'), PDFRawStream);
    return file.dict.get(PDFName.of('Filter'))?.toString() === '/FlateDecode'
      ? inflateSync(file.contents)
      : file.contents;
  };
  assert.equal(Buffer.from(extract(1)).toString(), packet.html);
  assert.deepEqual(Buffer.from(extract(3)), Buffer.from(original));
  assert.ok(!packet.html.includes('PRIVATE_MEDICAL_SENTINEL'));
});

test('unreadable attachment encoding refuses PDF creation', async () => {
  const packet = buildLocalSalePacket({
    horse,
    workspaceProfile: profile,
    documents: [],
    selectedDocumentIds: [],
    generatedBy: 'Synthetic reviewer',
  });
  await assert.rejects(
    renderLocalSalePacketPdf({
      packet,
      horse,
      profile,
      attachments: [
        {
          id: 'bad',
          fileName: 'bad.pdf',
          label: 'Bad original',
          dataUrl: 'https://invalid.example/file.pdf',
          sizeBytes: 10,
        },
      ],
      watermark: 'QA',
      branding: await branding(),
    }),
    /could not be read/,
  );
});
