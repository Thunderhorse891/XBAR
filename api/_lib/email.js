// Outbound email with a pluggable provider: Resend (RESEND_API_KEY) or
// SendGrid (SENDGRID_API_KEY). When neither is configured the caller gets
// { ok: false, skipped: true } and should fall back to in-app notifications.

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY);
}

/** Extract the bare address from a From value that may be in "Name <addr>" form. */
function extractAddress(value) {
  const match = /<([^<>]+)>/.exec(value || '');
  return (match ? match[1] : String(value || '')).trim();
}

/**
 * Build the From header. When the caller supplies a display name (e.g. the
 * ranch's business name on a buyer-facing sale-packet email), it replaces the
 * default display name while keeping the configured sending address — the
 * buyer sees the email as coming from the ranch, not the platform.
 */
function buildFrom(defaultFrom, fromName, fromEmail) {
  const name = String(fromName || '')
    .trim()
    .replace(/["\r\n]/g, '');
  if (!name) return defaultFrom;
  const address = String(fromEmail || '').trim() || extractAddress(defaultFrom) || 'no-reply@xbar.app';
  return `"${name}" <${address}>`;
}

export async function sendEmail({ to, subject, html, text, fromName, fromEmail, replyTo }) {
  const defaultFrom = process.env.EMAIL_FROM_ADDRESS || 'XBAR <no-reply@xbar.app>';
  const from = buildFrom(defaultFrom, fromName, fromEmail);
  const replyToAddress = String(replyTo || '').trim();
  if (!to) {
    return { ok: false, skipped: true, message: 'No recipient email available.' };
  }

  if (process.env.RESEND_API_KEY) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        text,
        ...(replyToAddress ? { reply_to: replyToAddress } : {}),
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { ok: false, message: `Resend send failed (${response.status}): ${detail.slice(0, 200)}` };
    }
    return { ok: true, provider: 'resend' };
  }

  if (process.env.SENDGRID_API_KEY) {
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: extractAddress(from) || extractAddress(defaultFrom) },
        ...(replyToAddress ? { replyTo: { email: replyToAddress } } : {}),
        subject,
        content: [
          { type: 'text/plain', value: text || '' },
          { type: 'text/html', value: html || `<pre>${text || ''}</pre>` },
        ],
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      return { ok: false, message: `SendGrid send failed (${response.status}): ${detail.slice(0, 200)}` };
    }
    return { ok: true, provider: 'sendgrid' };
  }

  return { ok: false, skipped: true, message: 'No email provider configured.' };
}
