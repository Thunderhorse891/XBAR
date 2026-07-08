import assert from 'node:assert/strict';
import test from 'node:test';
import { Readable } from 'node:stream';
import { deflateRawSync } from 'node:zlib';
import buyerInquiryHandler from '../../api/buyer-inquiries.js';
import buyerResponseHandler from '../../api/buyer-responses.js';
import {
  classifyDocumentType,
  extractRegistrationFields,
  extractCogginsFields,
  extractHealthCertFields,
  extractTransferFields,
  extractDocument,
  detectMultipleHorses,
  groupExtractionsIntoCandidates,
  normalizeDate,
  addOneYear,
  NEEDS_REVIEW_THRESHOLD,
} from '../../api/_lib/document-extraction.js';
import { templateCatalog, getTemplateById, renderTemplate } from '../../api/_lib/document-templates.js';
import { checkSalePacketCapacity, tierIncludesPlan } from '../../api/_lib/entitlements.js';
import { extractZipEntries, isZipBuffer } from '../../api/_lib/zip.js';
import { createSectionedPdf, assemblePacketPdf } from '../../api/_lib/pdf.js';

const REGISTRATION_TEXT = `ARABIAN HORSE ASSOCIATION
Certificate of Registration
Horse Name: Spirit of the Desert
Registration Number: AHA 0654321
Breed: Arabian
Color: Bay
Markings: Star and snip, left hind sock
Sex: Mare
Date Foaled: 04/12/2019
Sire: Desert Wind
Dam: Morning Glory
DNA Status: On File
Microchip Number: 985112004567890`;

const COGGINS_TEXT = `EQUINE INFECTIOUS ANEMIA (EIA) LABORATORY TEST
Horse Name: Spirit of the Desert
Registration Number: AHA 0654321
Test Date: 03/15/2026
Laboratory ID: LAB-88421
Result: NEGATIVE
Veterinarian: Dr. Maria Lopez
`;

const HEALTH_CERT_TEXT = `CERTIFICATE OF VETERINARY INSPECTION
Animal Name: Spirit of the Desert
Exam Date: 05/01/2026
Issuing Veterinarian: Dr. Maria Lopez
Destination: Triple Oak Farm, Lexington KY
Expiration Date: 06/01/2026
`;

async function invokeJsonHandler(handler, body) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = 'POST';
  req.url = '/api/buyer-inquiries';
  return new Promise((resolve) => {
    const response = {
      statusCode: 200,
      headers: {},
      setHeader(name, value) {
        this.headers[name] = value;
      },
      end(payload) {
        resolve({ statusCode: this.statusCode, body: JSON.parse(payload) });
      },
    };
    void handler(req, response);
  });
}

test('buyer proof requests require actionable details', async () => {
  const response = await invokeJsonHandler(buyerInquiryHandler, {
    sharePath: '/profiles/horse-1',
    kind: 'proof-requested',
    buyerName: 'Buyer',
    message: '',
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /Describe the proof/);
});

test('seller buyer responses require a target and response note', async () => {
  const response = await invokeJsonHandler(buyerResponseHandler, {
    workspaceId: 'workspace-1',
    replyToEventId: '',
    note: '',
  });
  assert.equal(response.statusCode, 400);
  assert.match(response.body.message, /Workspace, buyer request, and response note/);
});

test('classifies the four core document types', () => {
  assert.equal(classifyDocumentType(REGISTRATION_TEXT).type, 'registration');
  assert.equal(classifyDocumentType(COGGINS_TEXT).type, 'coggins');
  assert.equal(classifyDocumentType(HEALTH_CERT_TEXT).type, 'health_cert');
  assert.equal(classifyDocumentType('TRANSFER OF OWNERSHIP\nSeller: A\nBuyer: B').type, 'transfer');
  assert.equal(classifyDocumentType('BILL OF SALE for one horse').type, 'bill_of_sale');
  assert.equal(classifyDocumentType('grocery list: hay, carrots').type, 'unknown');
});

test('extracts registration paper fields', () => {
  const fields = extractRegistrationFields(REGISTRATION_TEXT);
  assert.equal(fields.name.value, 'Spirit of the Desert');
  assert.equal(fields.registrationNumber.value, 'AHA0654321');
  assert.equal(fields.breed.value, 'Arabian');
  assert.equal(fields.color.value, 'Bay');
  assert.equal(fields.gender.value, 'Mare');
  assert.equal(fields.birthdate.value, '2019-04-12');
  assert.equal(fields.sire.value, 'Desert Wind');
  assert.equal(fields.dam.value, 'Morning Glory');
  assert.equal(fields.microchip.value, '985112004567890');
});

test('extracts Coggins fields and derives the next due date one year out', () => {
  const fields = extractCogginsFields(COGGINS_TEXT);
  assert.equal(fields.testDate.value, '2026-03-15');
  assert.equal(fields.nextDueDate.value, '2027-03-15');
  assert.equal(fields.labId.value, 'LAB-88421');
  assert.equal(fields.result.value, 'negative');
  assert.equal(fields.veterinarian.value, 'Dr. Maria Lopez');
});

test('extracts health certificate fields', () => {
  const fields = extractHealthCertFields(HEALTH_CERT_TEXT);
  assert.equal(fields.examDate.value, '2026-05-01');
  assert.equal(fields.veterinarian.value, 'Dr. Maria Lopez');
  assert.match(fields.destination.value, /Triple Oak Farm/);
  assert.equal(fields.expiryDate.value, '2026-06-01');
});

test('extracts transfer of ownership fields', () => {
  const fields = extractTransferFields(`TRANSFER OF OWNERSHIP
Horse Name: Spirit of the Desert
Previous Owner: Jane Doe
New Owner: John Smith
Date of Sale: 06/05/2026`);
  assert.equal(fields.previousOwner.value, 'Jane Doe');
  assert.equal(fields.newOwner.value, 'John Smith');
  assert.equal(fields.saleDate.value, '2026-06-05');
});

test('high quality OCR clears the review threshold, low quality OCR does not', () => {
  const good = extractDocument({ text: REGISTRATION_TEXT, ocrConfidence: 0.99 });
  assert.equal(good.needsReview, false);
  assert.ok(good.overallConfidence >= NEEDS_REVIEW_THRESHOLD);

  const poor = extractDocument({ text: REGISTRATION_TEXT, ocrConfidence: 0.55 });
  assert.equal(poor.needsReview, true);
  assert.ok(poor.lowConfidenceFields.length > 0);

  const empty = extractDocument({ text: 'completely unrelated text', ocrConfidence: 0.99 });
  assert.equal(empty.needsReview, true);
});

test('a mare + foal document is flagged as multiple horses', () => {
  const text = `Certificate of Registration
Horse Name: Morning Glory
Registration Number: AHA 0111111
Horse Name: Glory Foal
Registration Number: AHA 0222222`;
  const detection = detectMultipleHorses(text);
  assert.equal(detection.multiple, true);
  const extraction = extractDocument({ text, ocrConfidence: 0.99 });
  assert.equal(extraction.needsReview, true);
});

test('Coggins + registration for the same horse merge into one candidate', () => {
  const registration = extractDocument({ text: REGISTRATION_TEXT, ocrConfidence: 0.99 });
  const coggins = extractDocument({ text: COGGINS_TEXT, ocrConfidence: 0.99 });
  const candidates = groupExtractionsIntoCandidates([
    { ...registration, ref: 'doc-1' },
    { ...coggins, ref: 'doc-2' },
  ]);
  assert.equal(candidates.length, 1);
  assert.deepEqual(candidates[0].documentRefs, ['doc-1', 'doc-2']);
  assert.equal(candidates[0].fields.breed, 'Arabian');
  assert.equal(candidates[0].fields.nextDueDate, '2027-03-15');
});

test('different horses stay separate candidates', () => {
  const a = extractDocument({ text: REGISTRATION_TEXT, ocrConfidence: 0.99 });
  const b = extractDocument({
    text: 'Certificate of Registration\nHorse Name: Thunderbolt\nRegistration Number: JC 9988776\nBreed: Thoroughbred',
    ocrConfidence: 0.99,
  });
  const candidates = groupExtractionsIntoCandidates([
    { ...a, ref: 'doc-1' },
    { ...b, ref: 'doc-2' },
  ]);
  assert.equal(candidates.length, 2);
});

test('date helpers normalize formats and add a year', () => {
  assert.equal(normalizeDate('03/15/2026'), '2026-03-15');
  assert.equal(normalizeDate('2026-3-5'), '2026-03-05');
  assert.equal(normalizeDate('March 15, 2026'), '2026-03-15');
  assert.equal(addOneYear('2026-03-15'), '2027-03-15');
  assert.equal(addOneYear('not a date'), '');
});

test('template catalog matches the tier matrix and renders placeholders', () => {
  assert.equal(templateCatalog.length, 15);
  assert.equal(templateCatalog.filter((t) => t.minimumPlan === 'Starter').length, 5);
  assert.equal(templateCatalog.filter((t) => t.minimumPlan === 'Professional').length, 5);
  assert.equal(templateCatalog.filter((t) => t.minimumPlan === 'Ranch Ops').length, 5);

  const template = getTemplateById('bill-of-sale');
  const rendered = renderTemplate({
    template,
    context: {
      horse: {
        name: 'Spirit',
        registrationNumber: 'AHA0654321',
        registry: 'AHA',
        breed: 'Arabian',
        color: 'Bay',
        birthdate: '2019-04-12',
        gender: 'Mare',
        microchip: '985112004567890',
      },
      owner: { name: 'Jane Doe' },
      workspace: { businessName: 'Triple Oak' },
      buyer: { name: 'John Smith' },
      today_date: '2026-06-09',
    },
  });
  assert.match(rendered.text, /Spirit/);
  assert.match(rendered.text, /John Smith/);
  assert.ok(rendered.missingFields.includes('sale.price'));
  assert.match(rendered.html, /<h1>Bill of Sale/);
});

test('DB template_content overrides the built-in body', () => {
  const template = getTemplateById('bill-of-sale');
  const rendered = renderTemplate({
    template,
    overrideContent: '<p>Custom sale of {{horse.name}}</p>',
    context: { horse: { name: 'Spirit' } },
  });
  assert.match(rendered.html, /Custom sale of Spirit/);
});

test('tier entitlement ladder enforces template access', () => {
  assert.equal(tierIncludesPlan('Starter', 'Starter'), true);
  assert.equal(tierIncludesPlan('Starter', 'Professional'), false);
  assert.equal(tierIncludesPlan('Professional', 'Starter'), true);
  assert.equal(tierIncludesPlan('Ranch Ops', 'Professional'), true);
  assert.equal(tierIncludesPlan('Enterprise', 'Ranch Ops'), true);
  assert.equal(tierIncludesPlan('Professional', 'Ranch Ops'), false);
});

test('server sale packet capacity blocks generation at the plan limit', async () => {
  const supabase = {
    from(table) {
      assert.equal(table, 'sale_packets');
      return {
        select(column, options) {
          assert.equal(column, 'packet_id');
          assert.deepEqual(options, { count: 'exact', head: true });
          return {
            async eq(field, value) {
              assert.equal(field, 'workspace_id');
              assert.equal(value, 'workspace-1');
              return { count: 2 };
            },
          };
        },
      };
    },
  };

  const blocked = await checkSalePacketCapacity(supabase, 'workspace-1', 1, { salePacketLimit: 2 });
  assert.equal(blocked.ok, false);
  assert.match(blocked.message, /2 sale packet limit/);
});

test('zip extraction handles stored and deflated entries', () => {
  const zip = buildZip([
    { name: 'coggins.txt', content: Buffer.from(COGGINS_TEXT), deflate: true },
    { name: 'note.txt', content: Buffer.from('hello'), deflate: false },
  ]);
  assert.equal(isZipBuffer(zip), true);
  const { entries, skipped } = extractZipEntries(zip);
  assert.equal(entries.length, 2);
  assert.equal(skipped.length, 0);
  assert.equal(entries[0].content.toString('utf8'), COGGINS_TEXT);
  assert.equal(entries[1].content.toString('utf8'), 'hello');
});

test('zip extraction skips entries exceeding per-entry size limit', () => {
  const big = Buffer.alloc(1024, 0x41);
  const zip = buildZip([
    { name: 'big.txt', content: big, deflate: true },
    { name: 'small.txt', content: Buffer.from('ok'), deflate: false },
  ]);
  const { entries, skipped } = extractZipEntries(zip, { maxEntryBytes: 512 });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].fileName, 'small.txt');
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /inflate failed/);
});

test('zip extraction stops when cumulative size limit is reached', () => {
  const a = Buffer.alloc(600, 0x42);
  const b = Buffer.alloc(600, 0x43);
  const zip = buildZip([
    { name: 'a.bin', content: a, deflate: false },
    { name: 'b.bin', content: b, deflate: false },
  ]);
  const { entries, skipped } = extractZipEntries(zip, { maxTotalBytes: 1000 });
  assert.equal(entries.length, 1);
  assert.equal(entries[0].fileName, 'a.bin');
  assert.equal(skipped.length, 1);
  assert.match(skipped[0].reason, /cumulative/);
});

test('PDF generation and packet assembly produce valid PDFs with watermarks', async () => {
  const cover = await createSectionedPdf({
    title: 'Sale Packet: Spirit',
    sections: [{ heading: 'Horse Summary', lines: ['Name: Spirit', 'Registration #: AHA0654321'] }],
    footer: 'XBAR test',
  });
  assert.equal(Buffer.from(cover.slice(0, 5)).toString('latin1'), '%PDF-');

  const packet = await assemblePacketPdf({
    coverBytes: cover,
    attachments: [
      { label: 'Coggins', mimeType: 'application/pdf', bytes: cover },
      { label: 'Photo', mimeType: 'text/plain', bytes: Buffer.from('not embeddable') },
    ],
    watermarkText: 'Copy for John Smith - 2026-06-09',
  });
  assert.equal(Buffer.from(packet.slice(0, 5)).toString('latin1'), '%PDF-');
  assert.ok(packet.length > cover.length);
});

// Minimal ZIP writer used only by these tests.
function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = Buffer.from(file.name, 'utf8');
    const data = file.deflate ? deflateRawSync(file.content) : file.content;
    const method = file.deflate ? 8 : 0;
    const crc = crc32(file.content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(file.content.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    localParts.push(local, nameBytes, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(file.content.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);

    offset += 30 + nameBytes.length + data.length;
  }

  const centralStart = offset;
  const centralBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(centralStart, 16);

  return Buffer.concat([...localParts, centralBuffer, eocd]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
