// Lifecycle email content and trigger-window logic for XBAR.
//
// This module is intentionally pure and dependency-free: templates and window
// decisions take explicit params and touch no network, database, or env. The
// DB-touching orchestration (claims, recipient lookup, sending) lives in
// ./lifecycleTriggers.js; the HTTP wrappers are api/account/[action].js
// (action `send-welcome`) and api/reminders/[action].js (action `trial-reminders`).
//
// Copy bar, per the owner: professional, plain-spoken, no hype. These go out
// under the ranch's name, so they read like a note from the operation, not a
// marketing drip.

export const SUPPORT_EMAIL = 'Xbarje@gmail.com';

// 14-day full Professional trial, no card. The sibling trial-mechanics build
// owns this number; it is repeated here only so the trigger windows below are
// readable without chasing another branch.
export const TRIAL_LENGTH_DAYS = 14;
// "Ending soon" window: remind this many days before trial end.
export const TRIAL_ENDING_SOON_DAYS = 3;
// After expiry, the "trial expired" email still goes out for this many days.
// Older expirations are left alone so a first deploy does not blast workspaces
// whose trials ended months ago.
export const TRIAL_EXPIRED_GRACE_DAYS = 3;

// Trial state contract, shared with the trial-mechanics build:
//
// The sibling branch writes the trial into the subscription profile JSON
// (the `payload` column of workspace_subscription_profiles — the same object
// the client gates on). Because its exact field names are not visible from
// this branch, resolveTrialEndDate reads, in order:
//   1. profile.payload.trial.endsAt    (ISO string — the real trial contract)
//   2. profile.trial.endsAt            (ISO string)
//   3. profile.trial_end / profile.trialEnd  (ISO string, legacy)
//   4. profile.trial.end / profile.trial.trial_end  (nested, ISO string)
//   5. profile.payload.trial.startedAt (+ TRIAL_LENGTH_DAYS)
//   6. profile.trial_start / profile.trialStart / profile.trial.start (+ TRIAL_LENGTH_DAYS)
// The first valid ISO date wins.
// HTML-escape for user-controlled values interpolated into email bodies.
// Workspace/ranch names and user display names come from the user, so they
// must never land raw in HTML — a ranch named `<img src=x onerror=...>`
// would otherwise inject markup into mail sent from XBAR. The plain-text
// versions keep the raw values: there is nothing to escape in plain text.
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function resolveTrialEndDate(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const trialObj = (v) => (v && typeof v === 'object' ? v : null);
  const nestedTrial = trialObj(profile.trial) || trialObj(profile.payload && profile.payload.trial);
  const candidates = [
    nestedTrial ? nestedTrial.endsAt : null,
    profile.trial_end,
    profile.trialEnd,
    nestedTrial ? nestedTrial.end : null,
    nestedTrial ? nestedTrial.trial_end : null,
  ];
  for (const candidate of candidates) {
    const iso = normalizeIsoDate(candidate);
    if (iso) return iso;
  }
  const starts = [
    nestedTrial ? nestedTrial.startedAt : null,
    profile.trial_start,
    profile.trialStart,
    nestedTrial ? nestedTrial.start : null,
  ];
  for (const start of starts) {
    const iso = normalizeIsoDate(start);
    if (iso) {
      const end = new Date(iso);
      end.setUTCDate(end.getUTCDate() + TRIAL_LENGTH_DAYS);
      return end.toISOString().slice(0, 10);
    }
  }
  return null;
}

function normalizeIsoDate(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return null;
  const parsed = new Date(trimmed.length === 10 ? `${trimmed}T00:00:00Z` : trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

// Which trial email (if any) a workspace is due, by calendar day (UTC).
// Returns 'ending-soon', 'expired', or null.
//   nowIso: ISO timestamp of "now" (explicit param so tests do not depend on
//   the clock).
export function trialReminderKind({ trialEndDate, nowIso, endingSoonDays = TRIAL_ENDING_SOON_DAYS }) {
  if (!trialEndDate || !/^\d{4}-\d{2}-\d{2}$/.test(trialEndDate)) return null;
  const now = new Date(nowIso);
  if (Number.isNaN(now.getTime())) return null;
  const today = now.toISOString().slice(0, 10);
  const daysUntilEnd = Math.round(
    (Date.parse(`${trialEndDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  if (daysUntilEnd >= 1 && daysUntilEnd <= endingSoonDays) return 'ending-soon';
  if (daysUntilEnd <= 0 && daysUntilEnd >= -TRIAL_EXPIRED_GRACE_DAYS) return 'expired';
  return null;
}

// Idempotency key for a lifecycle email. Keyed on the trial end DATE (not the
// run date) so a retried cron or a second trial period cannot double-send and
// a renewed trial gets its own emails.
export function lifecycleEventKey(kind, workspaceId, dedupeKey) {
  return `xbar:lifecycle:${kind}:${workspaceId}:${dedupeKey}`;
}

function appUrl() {
  return (process.env.PUBLIC_APP_URL || process.env.VITE_PUBLIC_APP_URL || 'https://xbar.app').replace(/\/$/, '');
}

function billingUrl() {
  return `${appUrl()}/billing`;
}

// Inline brand styles. Email clients do not load external stylesheets, so the
// XBAR tokens (public/brand/xbar-brand-tokens.css) are inlined here by value:
// --xbar-black #0b0d0f, --xbar-graphite #121518, --xbar-warm-white #f5f2ec,
// --xbar-muted-sand #c7bdaa, --xbar-silver #b7bcc2, --xbar-blue #0078d7.
function emailShell({ preheader, heading, bodyHtml, cta }) {
  const ctaHtml = cta
    ? `<p style="margin:28px 0 8px;"><a href="${cta.url}" style="display:inline-block;background-color:#0078d7;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:6px;">${cta.label}</a></p>`
    : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background-color:#0b0d0f;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b0d0f;padding:32px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#121518;border-radius:10px;overflow:hidden;">
<tr><td style="padding:28px 32px 8px;">
<p style="margin:0 0 4px;font-size:13px;letter-spacing:3px;color:#c7bdaa;font-weight:700;">XBAR</p>
<h1 style="margin:0;font-size:22px;line-height:1.3;color:#f5f2ec;font-weight:700;">${heading}</h1>
</td></tr>
<tr><td style="padding:8px 32px 8px;font-size:15px;line-height:1.6;color:#b7bcc2;">
${bodyHtml}
${ctaHtml}
<p style="margin:24px 0 4px;font-size:13px;color:#596168;">Questions? Reply to this email or write to <a href="mailto:${SUPPORT_EMAIL}" style="color:#c7bdaa;">${SUPPORT_EMAIL}</a>.</p>
</td></tr>
<tr><td style="padding:16px 32px 28px;font-size:12px;color:#596168;border-top:1px solid #20252a;">
<p style="margin:0;">XBAR — one trustworthy record per horse: documents, ownership, care, and sale readiness.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function paragraphs(lines) {
  return lines.map((line) => `<p style="margin:0 0 14px;">${line}</p>`).join('');
}

function formatLongDate(isoDate) {
  const parsed = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return isoDate;
  return parsed.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
}

export function buildWelcomeEmail({ recipientName = '', ranchName = '' } = {}) {
  const greetingHtml = recipientName ? `Hi ${escapeHtml(recipientName)},` : 'Hi,';
  const greetingText = recipientName ? `Hi ${recipientName},` : 'Hi,';
  const ranchLine = ranchName
    ? `Your ranch workspace, <strong style="color:#f5f2ec;">${escapeHtml(ranchName)}</strong>, is set up and your 14-day Professional trial is running — the full plan, no card required.`
    : 'Your ranch workspace is set up and your 14-day Professional trial is running — the full plan, no card required.';
  const body = paragraphs([
    `${greetingHtml} welcome to XBAR.`,
    'XBAR keeps one trustworthy record per horse — documents, ownership, care, and sale readiness — so the records behind your money decisions are the ones you can prove.',
    ranchLine,
    'Three things worth doing first:',
    '1. <strong style="color:#f5f2ec;">Add your first horse.</strong> Name, registration, and the basics — it takes a minute.<br>' +
      '2. <strong style="color:#f5f2ec;">Upload a document.</strong> A Coggins, registration paper, or bill of sale — XBAR reads it and attaches it to the right horse.<br>' +
      '3. <strong style="color:#f5f2ec;">Set one reminder.</strong> Vaccination, farrier, or Coggins renewal — due dates stop living in your head.',
    'When the trial ends you keep every record you entered. The workspace simply moves to the free baseline until you pick a plan.',
  ]);
  const text =
    `${greetingText} welcome to XBAR.\n\n` +
    `XBAR keeps one trustworthy record per horse — documents, ownership, care, and sale readiness.\n\n` +
    `Your ranch workspace${ranchName ? ` (${ranchName})` : ''} is set up and your 14-day Professional trial is running — the full plan, no card required.\n\n` +
    `Three things worth doing first:\n` +
    `1. Add your first horse — name, registration, and the basics.\n` +
    `2. Upload a document — a Coggins, registration paper, or bill of sale; XBAR reads it and attaches it to the right horse.\n` +
    `3. Set one reminder — vaccination, farrier, or Coggins renewal.\n\n` +
    `When the trial ends you keep every record you entered. The workspace simply moves to the free baseline until you pick a plan.\n\n` +
    `Open XBAR: ${appUrl()}\n\nQuestions? Reply to this email or write to ${SUPPORT_EMAIL}.`;
  return {
    subject: 'Welcome to XBAR — your ranch workspace is ready',
    text,
    html: emailShell({
      preheader: 'Your 14-day Professional trial is running. Three first steps inside.',
      heading: 'Welcome to XBAR',
      bodyHtml: body,
      cta: { label: 'Open your workspace', url: appUrl() },
    }),
  };
}

export function buildTrialEndingEmail({ ranchName = '', trialEndDate, daysLeft } = {}) {
  const dateLine = trialEndDate ? `on <strong style="color:#f5f2ec;">${formatLongDate(trialEndDate)}</strong>` : 'soon';
  const daysLine =
    typeof daysLeft === 'number' && daysLeft >= 0 ? ` (${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left)` : '';
  const body = paragraphs([
    `Your 14-day Professional trial${ranchName ? ` for <strong style="color:#f5f2ec;">${escapeHtml(ranchName)}</strong>` : ''} ends ${dateLine}${daysLine}.`,
    'Right now you have the full Professional plan: sale packets and buyer folders, shared sale listings, 30 horses, 1,000 documents, and team seats. After the trial the workspace moves to the free baseline — your horses, documents, and records stay exactly as they are, but sale packets, shared listings, and the higher limits pause until you pick a plan.',
    'Nothing is charged automatically — there is no card on file. If XBAR is earning its keep, choose the plan that fits and everything keeps working without a break.',
  ]);
  return {
    subject: `Your XBAR Professional trial ends ${trialEndDate ? formatLongDate(trialEndDate) : 'soon'}`,
    text:
      `Your 14-day Professional trial${ranchName ? ` for ${ranchName}` : ''} ends ${trialEndDate ? formatLongDate(trialEndDate) : 'soon'}${daysLine}.\n\n` +
      `Right now you have the full Professional plan: sale packets and buyer folders, shared sale listings, 30 horses, 1,000 documents, and team seats. After the trial the workspace moves to the free baseline — your horses, documents, and records stay exactly as they are, but sale packets, shared listings, and the higher limits pause until you pick a plan.\n\n` +
      `Nothing is charged automatically — there is no card on file. If XBAR is earning its keep, choose the plan that fits and everything keeps working without a break.\n\n` +
      `See plans: ${billingUrl()}\n\nQuestions? Reply to this email or write to ${SUPPORT_EMAIL}.`,
    html: emailShell({
      preheader: `Your Professional trial ends ${trialEndDate ? formatLongDate(trialEndDate) : 'soon'}. Your records stay either way.`,
      heading: 'Your trial is ending',
      bodyHtml: body,
      cta: { label: 'See plans', url: billingUrl() },
    }),
  };
}

export function buildTrialExpiredEmail({ ranchName = '' } = {}) {
  const body = paragraphs([
    `Your 14-day Professional trial${ranchName ? ` for <strong style="color:#f5f2ec;">${escapeHtml(ranchName)}</strong>` : ''} has ended.`,
    'The workspace is now on the free baseline. Nothing you entered is gone — every horse, document, expense, and reminder is still there, and it all comes back in full the moment you pick a plan.',
    'What changed: the workspace is back to Starter limits (5 horses, 250 documents, 1 seat), and sale packets, shared sale listings, and the other Professional features are paused.',
    'If you were in the middle of something — a sale packet, a listing, a stack of intake — upgrading restores it exactly where you left it.',
  ]);
  return {
    subject: 'Your XBAR trial has ended — your records are safe',
    text:
      `Your 14-day Professional trial${ranchName ? ` for ${ranchName}` : ''} has ended.\n\n` +
      `The workspace is now on the free baseline. Nothing you entered is gone — every horse, document, expense, and reminder is still there, and it all comes back in full the moment you pick a plan.\n\n` +
      `What changed: the workspace is back to Starter limits (5 horses, 250 documents, 1 seat), and sale packets, shared sale listings, and the other Professional features are paused.\n\n` +
      `If you were in the middle of something — a sale packet, a listing, a stack of intake — upgrading restores it exactly where you left it.\n\n` +
      `See plans: ${billingUrl()}\n\nQuestions? Reply to this email or write to ${SUPPORT_EMAIL}.`,
    html: emailShell({
      preheader: 'Your trial ended. Every record is still there — pick a plan to pick up where you left off.',
      heading: 'Your trial has ended',
      bodyHtml: body,
      cta: { label: 'See plans', url: billingUrl() },
    }),
  };
}

// Dunning: a payment failed. billingPortalUrl may be empty (the
// VITE_STRIPE_BILLING_PORTAL_URL setting is optional) — the copy then points
// at the Billing page in the app instead of rendering a dead link.
export function buildPaymentFailedEmail({ ranchName = '', planName = '', billingPortalUrl = '' } = {}) {
  const portal = String(billingPortalUrl || '').trim();
  const updateLine = portal
    ? 'Use the button below to open the secure billing portal and update your payment method.'
    : `Open the Billing page in XBAR (${billingUrl()}) and update your payment method there.`;
  const what = [ranchName, planName].filter(Boolean).join(' — ');
  const planLine = what ? ` for <strong style="color:#f5f2ec;">${escapeHtml(what)}</strong>` : '';
  const body = paragraphs([
    `Heads up: the latest payment${planLine} didn't go through.`,
    'Your records are unaffected. Stripe will retry the charge automatically, and your workspace keeps working in the meantime.',
    updateLine,
    'If the card on file changed or expired, updating it now is the fastest way to keep billing from interrupting anything.',
  ]);
  return {
    subject: "XBAR: your payment didn't go through",
    text:
      `Heads up: the latest payment${what ? ` for ${what}` : ''} didn't go through.\n\n` +
      `Your records are unaffected. Stripe will retry the charge automatically, and your workspace keeps working in the meantime.\n\n` +
      (portal
        ? `Update your payment method in the secure billing portal: ${portal}\n\n`
        : `Open the Billing page in XBAR (${billingUrl()}) and update your payment method there.\n\n`) +
      `If the card on file changed or expired, updating it now is the fastest way to keep billing from interrupting anything.\n\n` +
      `Questions? Reply to this email or write to ${SUPPORT_EMAIL}.`,
    html: emailShell({
      preheader: "Your latest XBAR payment didn't go through. Your records are unaffected.",
      heading: 'A payment needs attention',
      bodyHtml: body,
      cta: portal ? { label: 'Update payment method', url: portal } : { label: 'Open Billing', url: billingUrl() },
    }),
  };
}
