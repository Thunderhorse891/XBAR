// Optional, low-volume Gmail transport. Credentials stay server-side; enabling
// this does not establish inbox delivery or configure Supabase Auth SMTP.
import nodemailer from 'nodemailer';
import { domainToASCII } from 'node:url';

const GMAIL_ADDRESS = /^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@(gmail\.com|googlemail\.com)$/i;
function canonicalRecipient(value) {
  if (typeof value !== 'string') return '';
  const parts = value.trim().split('@');
  if (parts.length !== 2 || !/^[A-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i.test(parts[0]))
    return '';
  // domainToASCII also accepts URL-like input and truncates at delimiters.
  // Reject those forms before normalization so the target cannot change.
  if (/[\s/\\?#%:@[\]]/.test(parts[1])) return '';
  const domain = domainToASCII(parts[1]);
  if (
    Array.from(parts[1]).every((character) => character.charCodeAt(0) <= 127) &&
    domain.toLowerCase() !== parts[1].toLowerCase()
  )
    return '';
  if (!domain || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i.test(domain)) return '';
  return `${parts[0]}@${domain.toLowerCase()}`;
}

export function gmailSmtpStatus() {
  const enabled = process.env.GMAIL_SMTP_ENABLED?.trim() === 'true';
  const user = process.env.GMAIL_SMTP_USER?.trim() || '';
  const password = (process.env.GMAIL_SMTP_APP_PASSWORD || '').replace(/\s/g, '');
  const configured = enabled && GMAIL_ADDRESS.test(user) && /^[a-z]{16}$/i.test(password);
  return { enabled, configured };
}

export async function sendGmailEmail(
  { to, subject, html, text, fromName, replyTo },
  createTransport = nodemailer.createTransport,
) {
  if (!gmailSmtpStatus().configured) {
    return { ok: false, skipped: true, message: 'Gmail SMTP is disabled or incompletely configured.' };
  }
  const recipient = canonicalRecipient(to);
  if (!recipient) {
    return { ok: false, rejected: true, message: 'Gmail SMTP requires one valid recipient email address.' };
  }
  const user = process.env.GMAIL_SMTP_USER.trim();
  const transport = createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass: process.env.GMAIL_SMTP_APP_PASSWORD.replace(/\s/g, '') },
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 10000,
    pool: false,
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  try {
    const info = await transport.sendMail({
      from: {
        address: user,
        name: String(fromName || 'XBAR')
          .replace(/[\r\n]/g, '')
          .trim(),
      },
      to: [{ address: recipient }],
      envelope: { from: user, to: [recipient] },
      subject,
      html,
      text,
      ...(replyTo ? { replyTo: { address: replyTo } } : {}),
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    const accepted =
      Array.isArray(info?.accepted) &&
      info.accepted.some((address) => typeof address === 'string' && address.toLowerCase() === recipient.toLowerCase());
    if (!accepted || info.rejected?.length || info.pending?.length) {
      return { ok: false, message: 'Gmail acceptance was not confirmed; reconcile before retrying.' };
    }
    return { ok: true, provider: 'gmail-smtp' };
  } catch (error) {
    // SMTP negative acknowledgements explicitly decline the message. A lost
    // connection/timeout can follow acceptance, and must never auto-retry.
    const code = Number(error?.responseCode);
    const rejected = Number.isInteger(code) && code >= 400 && code < 600;
    const rateLimited = code === 454 || (rejected && /\b[45]\.4\.5\b/.test(String(error?.response || '')));
    return {
      ok: false,
      ...(rejected ? { rejected: true } : {}),
      ...(rateLimited || (rejected && code < 500)
        ? { retryable: true, retryAfterSeconds: rateLimited ? 86400 : 3600 }
        : {}),
      // Never return raw SMTP errors: they can include credentials or recipients.
      message: rejected
        ? `Gmail SMTP rejected the request (${code})${rateLimited ? '; daily limit or temporary account limit reached' : ''}.`
        : 'Gmail SMTP outcome is uncertain; reconcile before retrying.',
    };
  } finally {
    transport.close();
  }
}
