// Outbound email with a pluggable provider: Resend (RESEND_API_KEY) or
// SendGrid (SENDGRID_API_KEY). When neither is configured the caller gets
// { ok: false, skipped: true } and should fall back to in-app notifications.

export function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY);
}

export async function sendEmail({ to, subject, html, text }) {
  const from = process.env.EMAIL_FROM_ADDRESS || 'XBAR <no-reply@xbar.app>';
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
      body: JSON.stringify({ from, to: [to], subject, html, text }),
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
        from: { email: from.replace(/^.*<|>$/g, '') || from },
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
