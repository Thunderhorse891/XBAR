import type { DocumentRecord, HorseRecord, SharedListingRecord } from '../types/xbar.js';

export type PublicBuyerPacketArtifact = {
  fileName: string;
  html: string;
};

export type PublicBuyerPacketHorse = Pick<
  HorseRecord,
  'name' | 'breed' | 'sex' | 'age' | 'color' | 'registry' | 'registrationNumber' | 'aqhaNumber' | 'sale' | 'readiness'
>;

export type PublicBuyerPacketDocument = Pick<DocumentRecord, 'title' | 'type' | 'summary'>;

export type PublicBuyerPacketListing = Pick<SharedListingRecord, 'accessMode'>;

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cleanFileName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'horse';
}

function row(label: string, value: unknown) {
  return `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value || 'Not provided')}</td></tr>`;
}

export function buildPublicBuyerPacketArtifact(params: {
  horse: PublicBuyerPacketHorse;
  documents: PublicBuyerPacketDocument[];
  sharedListing?: PublicBuyerPacketListing;
  generatedAt?: Date;
}): PublicBuyerPacketArtifact {
  const generatedOn = (params.generatedAt ?? new Date()).toISOString().slice(0, 10);
  const registration = params.horse.registrationNumber || params.horse.aqhaNumber;
  const documents = params.documents.length
    ? params.documents.map((document) => `
      <article>
        <div class="document-heading">
          <strong>${escapeHtml(document.title)}</strong>
          <span>${escapeHtml(document.type)}</span>
        </div>
        <p>${escapeHtml(document.summary || 'Approved buyer-facing record.')}</p>
      </article>`).join('')
    : '<p class="muted">No approved buyer-facing documents are included.</p>';

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>XBAR Buyer Packet - ${escapeHtml(params.horse.name)}</title>
  <style>
    :root{color:#20252b;background:#f5f7f9;font-family:Inter,Arial,sans-serif}
    body{margin:0;padding:40px 20px;background:#f5f7f9}
    main{max-width:820px;margin:0 auto;background:#fff;border:1px solid #dce2e8;border-radius:16px;box-shadow:0 18px 50px rgba(31,41,55,.08);overflow:hidden}
    header{padding:32px 36px;background:#20252b;color:#fff;border-bottom:4px solid #3478b8}
    .eyebrow{color:#9cc7ec;font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase}
    h1{font-size:34px;margin:8px 0 6px}header p{margin:0;color:#dce6ef}
    section{padding:26px 36px;border-bottom:1px solid #e4e9ee}
    h2{font-size:15px;letter-spacing:.12em;text-transform:uppercase;margin:0 0 16px;color:#3478b8}
    table{width:100%;border-collapse:collapse}th,td{padding:10px 0;border-bottom:1px solid #edf0f3;text-align:left;vertical-align:top}
    th{width:34%;color:#66717d;font-size:12px;text-transform:uppercase;letter-spacing:.06em}td{font-weight:600}
    article{padding:14px 0;border-bottom:1px solid #edf0f3}.document-heading{display:flex;justify-content:space-between;gap:12px}
    article span,.muted{color:#66717d}article p{margin:6px 0 0;color:#4b5560}
    .notice{margin:0;padding:22px 36px;background:#f0f5fa;color:#4b5560;font-size:13px;line-height:1.6}
  </style>
</head>
<body>
  <main>
    <header>
      <div class="eyebrow">XBAR verified buyer packet</div>
      <h1>${escapeHtml(params.horse.name)}</h1>
      <p>Generated ${escapeHtml(generatedOn)} from the seller-approved public profile.</p>
    </header>
    <section>
      <h2>Horse profile</h2>
      <table>
        ${row('Breed / sex', [params.horse.breed, params.horse.sex].filter(Boolean).join(' / '))}
        ${row('Age', params.horse.age > 0 ? params.horse.age : '')}
        ${row('Color', params.horse.color)}
        ${row('Registry', params.horse.registry)}
        ${row('Registration', registration)}
        ${row('Asking price', params.horse.sale.askPrice ? `$${params.horse.sale.askPrice.toLocaleString('en-US')}` : 'Contact seller')}
      </table>
    </section>
    <section>
      <h2>Release posture</h2>
      <table>
        ${row('Listing state', params.horse.sale.listingState)}
        ${row('Packet status', params.horse.readiness.packetStatus)}
        ${row('Record complete', `${params.horse.readiness.score}%`)}
        ${row('Access mode', params.sharedListing?.accessMode)}
      </table>
    </section>
    <section>
      <h2>Approved document summaries</h2>
      ${documents}
    </section>
    <p class="notice">Information is provided by the seller for buyer review. Buyers remain responsible for independent verification of registration, ownership, health status, and sale terms before purchase or transfer.</p>
  </main>
</body>
</html>`;

  return {
    fileName: `xbar-buyer-packet-${cleanFileName(params.horse.name)}.html`,
    html,
  };
}

export function downloadPublicBuyerPacketArtifact(artifact: PublicBuyerPacketArtifact) {
  const blob = new Blob([artifact.html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = artifact.fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
