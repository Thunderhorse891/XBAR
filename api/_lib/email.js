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

/** Extract the display name from a From value in "Name <addr>" form, if any. */
function extractName(value) {
  const text = String(value || '').trim();
  const quoted = /^"((?:[^"\\]|\\.)*)"\s*<[^<>]+>\s*$/.exec(text);
  if (quoted) return quoted[1].trim();
  const unquoted = /^([^<>"]+?)\s*<[^<>]+>\s*$/.exec(text);
  return unquoted ? unquoted[1].trim() : '';
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

/**
 * Wrap outbound HTML in the XBAR brand shell: a dark header with the
 * letterspaced wordmark, the caller's content on white, and a muted footer.
 * Token hexes are inlined (email clients cannot rely on the app's CSS
 * variables): --xbar-black #0b0d0f, --xbar-warm-white #f5f2ec,
 * --accent-edge #0078d7. No images — remote art is blocked by most inboxes.
 */
const EMAIL_FONT_STACK = "'Outfit', -apple-system, 'Segoe UI', Arial, sans-serif";

export function brandEmailHtml(html, text) {
  const inner =
    html || (text ? `<pre style="margin:0;white-space:pre-wrap;font-family:${EMAIL_FONT_STACK};">${text}</pre>` : '');
  return (
    `<div style="font-family:${EMAIL_FONT_STACK};background:#f5f6f7;padding:24px 16px;">` +
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e0e3e6;border-radius:10px;overflow:hidden;">` +
    `<div style="background:#0b0d0f;padding:18px 24px;border-bottom:2px solid #0078d7;">` +
    `<span style="color:#f5f2ec;font-size:15px;font-weight:800;letter-spacing:0.28em;">XBAR</span>` +
    `</div>` +
    `<div style="padding:24px;color:#202428;font-size:14px;line-height:1.6;">${inner}</div>` +
    `<div style="padding:14px 24px;border-top:1px solid #e0e3e6;color:#6b737c;font-size:12px;">Sent from XBAR — the private ranch operating system.</div>` +
    `</div></div>`
  );
}

export async function sendEmail({ to, subject, html, text, fromName, fromEmail, replyTo }) {
  const defaultFrom = process.env.EMAIL_FROM_ADDRESS || 'XBAR <no-reply@xbar.app>';
  const from = buildFrom(defaultFrom, fromName, fromEmail);
  const replyToAddress = String(replyTo || '').trim();
  if (!to) {
    return { ok: false, skipped: true, message: 'No recipient email available.' };
  }

  const brandedHtml = brandEmailHtml(html, text);

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
        html: brandedHtml,
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
    const fromAddress = extractAddress(from) || extractAddress(defaultFrom);
    const fromNameValue = extractName(from);
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        // Raw v3 API field names: `reply_to` (object) and `from` with a
        // separate `name`. The `replyTo` spelling belongs to the SendGrid
        // JS helper, not the API — sending it raw means SendGrid ignores
        // the field and replies fall back to the no-reply sender.
        from: { email: fromAddress, ...(fromNameValue ? { name: fromNameValue } : {}) },
        ...(replyToAddress ? { reply_to: { email: replyToAddress } } : {}),
        subject,
        content: [
          { type: 'text/plain', value: text || '' },
          { type: 'text/html', value: brandedHtml },
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
