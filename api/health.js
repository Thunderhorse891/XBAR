import { sendJson } from './_lib/http.js';

/*
 * Liveness/readiness probe for uptime monitoring and load balancers.
 * Reports which subsystems are configured without leaking any secret values,
 * and never touches the database — it must stay cheap enough to poll.
 */

export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJson(res, 405, { ok: false, message: 'Method not allowed.' });
  }

  const subsystems = {
    supabaseAdmin: Boolean(
      (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) && process.env.SUPABASE_SERVICE_ROLE_KEY,
    ),
    stripeBilling: Boolean(process.env.STRIPE_SECRET_KEY),
    stripeWebhook: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    email: Boolean(process.env.RESEND_API_KEY || process.env.SENDGRID_API_KEY),
    remindersCron: Boolean(process.env.CRON_SECRET),
  };

  res.setHeader('Cache-Control', 'no-store, max-age=0');
  return sendJson(res, 200, {
    ok: true,
    status: 'healthy',
    timestamp: new Date().toISOString(),
    subsystems,
  });
}
