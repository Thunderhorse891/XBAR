import { createHash, createHmac } from 'node:crypto';

// OCR provider chain:
//   1. `providedText` — the client already ran tesseract.js / pdf.js locally
//      (src/lib/documentIntelligence.ts) and sends the text alongside the file.
//   2. AWS Textract DetectDocumentText — enabled with OCR_PROVIDER=textract and
//      AWS credentials; called over REST with SigV4 so no SDK dependency is
//      needed in the serverless bundle.
//   3. Plain-text passthrough for text/* uploads.
// Anything else returns confidence 0 and the document is flagged for review.

const TEXTRACT_SUPPORTED = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/tiff', 'application/pdf']);

export function isTextractConfigured() {
  return (
    (process.env.OCR_PROVIDER || '').toLowerCase() === 'textract' &&
    Boolean(process.env.AWS_ACCESS_KEY_ID) &&
    Boolean(process.env.AWS_SECRET_ACCESS_KEY)
  );
}

function hmac(key, value) {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex');
}

function buildSigV4Headers({ region, service, host, payload, target }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(payload);

  const canonicalHeaders = `content-type:application/x-amz-json-1.1\nhost:${host}\nx-amz-date:${amzDate}\nx-amz-target:${target}\n`;
  const signedHeaders = 'content-type;host;x-amz-date;x-amz-target';
  const canonicalRequest = `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${sha256Hex(canonicalRequest)}`;

  const kDate = hmac(`AWS4${process.env.AWS_SECRET_ACCESS_KEY}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const headers = {
    'Content-Type': 'application/x-amz-json-1.1',
    'X-Amz-Date': amzDate,
    'X-Amz-Target': target,
    Authorization: `AWS4-HMAC-SHA256 Credential=${process.env.AWS_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (process.env.AWS_SESSION_TOKEN) {
    headers['X-Amz-Security-Token'] = process.env.AWS_SESSION_TOKEN;
  }
  return headers;
}

async function detectDocumentText(buffer) {
  const region = process.env.AWS_REGION || 'us-east-1';
  const host = `textract.${region}.amazonaws.com`;
  const payload = JSON.stringify({ Document: { Bytes: buffer.toString('base64') } });
  const headers = buildSigV4Headers({
    region,
    service: 'textract',
    host,
    payload,
    target: 'Textract.DetectDocumentText',
  });

  const response = await fetch(`https://${host}/`, { method: 'POST', headers, body: payload });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Textract request failed (${response.status}): ${detail.slice(0, 300)}`);
  }

  const result = await response.json();
  const lines = (result.Blocks || []).filter((block) => block.BlockType === 'LINE');
  const text = lines.map((line) => line.Text || '').join('\n');
  const confidences = lines.map((line) => Number(line.Confidence || 0));
  const confidence = confidences.length
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length / 100
    : 0;

  return { text, confidence };
}

export async function runOcr({ buffer, mimeType = '', providedText = '', providedConfidence }) {
  const trimmedProvided = String(providedText || '').trim();
  if (trimmedProvided) {
    return {
      ok: true,
      provider: 'client',
      text: trimmedProvided,
      confidence: clampConfidence(providedConfidence, 0.85),
    };
  }

  if (buffer?.length && mimeType.startsWith('text/')) {
    return { ok: true, provider: 'plain-text', text: buffer.toString('utf8'), confidence: 0.99 };
  }

  if (buffer?.length && isTextractConfigured() && TEXTRACT_SUPPORTED.has(mimeType.toLowerCase())) {
    try {
      const { text, confidence } = await detectDocumentText(buffer);
      return { ok: Boolean(text), provider: 'textract', text, confidence };
    } catch (error) {
      return { ok: false, provider: 'textract', text: '', confidence: 0, error: error.message };
    }
  }

  return { ok: false, provider: 'none', text: '', confidence: 0 };
}

function clampConfidence(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(1, Math.max(0, parsed > 1 ? parsed / 100 : parsed));
}
