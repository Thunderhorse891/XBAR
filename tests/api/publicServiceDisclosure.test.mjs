import test from 'node:test';
import assert from 'node:assert/strict';
import health from '../../api/health.js';
import { sendEmail } from '../../api/_lib/email.js';

const internal = /RESEND|SENDGRID|SMTP|STRIPE_|SUPABASE_|sk_live_|private-provider-detail/i;

test('public health response never includes configuration diagnostics', async () => {
  const saved = { ...process.env };
  try {
    for (const name of Object.keys(process.env))
      if (/^(RESEND|SENDGRID|GMAIL|SMTP|STRIPE|SUPABASE|VITE_STRIPE|MANAGED_BILLING|VITE_MANAGED)/.test(name))
        delete process.env[name];
    let body;
    health(
      { method: 'GET' },
      {
        setHeader() {},
        end(value) {
          body = JSON.parse(value);
        },
      },
    );
    assert.equal(body.subsystems.email, false);
    assert.doesNotMatch(JSON.stringify(body), internal);
    assert.match(body.warnings.join(' '), /Email service is currently unavailable\. Please contact support\./);
    process.env.VITE_STRIPE_PAYMENT_LINK_STARTER = 'https://buy.stripe.com/test_synthetic';
    health(
      { method: 'GET' },
      {
        setHeader() {},
        end(value) {
          body = JSON.parse(value);
        },
      },
    );
    assert.equal(body.checks.manualPlanConfirmationRequired, true);
    assert.match(body.warnings.join(' '), /manual plan confirmation/);
    assert.doesNotMatch(JSON.stringify(body), internal);
  } finally {
    process.env = saved;
  }
});

test('email rejection and transport exceptions expose stable public copy and retain retry semantics', async () => {
  const saved = { ...process.env },
    originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const logs = [];
  console.warn = (...args) => logs.push(args);
  try {
    process.env.RESEND_API_KEY = 'synthetic-key';
    for (const status of [400, 429, 500]) {
      globalThis.fetch = async () => new Response('RESEND_API_KEY private-provider-detail sk_live_private', { status });
      const result = await sendEmail({ to: 'synthetic@example.invalid', subject: 'Synthetic', text: 'Synthetic' });
      assert.equal(result.ok, false);
      assert.doesNotMatch(JSON.stringify(result), internal);
      assert.equal(result.message, 'Email service is currently unavailable. Please contact support.');
      if (status === 429) assert.equal(result.retryable, true);
      if (status === 400) assert.equal(result.rejected, true);
    }
    globalThis.fetch = async () => {
      throw new Error('SMTP private-provider-detail');
    };
    const result = await sendEmail({ to: 'synthetic@example.invalid', subject: 'Synthetic', text: 'Synthetic' });
    assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), internal);
    assert.doesNotMatch(JSON.stringify(logs), /RESEND_API_KEY|private-provider-detail|sk_live_private/);
  } finally {
    process.env = saved;
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});
