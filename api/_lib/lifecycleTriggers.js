// Lifecycle email triggers: idempotent, DB-backed orchestration for the
// templates in ./lifecycleEmails.js.
//
// IDEMPOTENCY WITHOUT A MIGRATION
//
// Every lifecycle email is claimed by inserting a row into
// `workspace_subscription_events` with a synthetic `stripe_event_id` of the
// form `xbar:lifecycle:<kind>:<workspace-or-user>:<dedupe-key>`. That column
// is UNIQUE, so the claim is atomic: a 23505 conflict means the email was
// already sent (or is being sent) and the caller skips. A send that fails
// DELETES the claim row so the next run retries — a claim is only kept when
// the provider confirmed the send.
//
// Why this table: the billing webhook writes it append-only and never
// updates or deletes rows, so flags stored here survive the subscription
// sync (unlike keys stuffed into the profile payload, which the webhook
// rewrites wholesale). Synthetic ids cannot collide with real Stripe
// `evt_...` ids, and the webhook's replay guard only matches exact ids, so
// the billing flow never sees these rows. The FK to workspaces cascades, so
// a deleted workspace cleans up its own flags.

import {
  buildWelcomeEmail,
  buildTrialEndingEmail,
  buildTrialExpiredEmail,
  buildPaymentFailedEmail,
  resolveTrialEndDate,
  trialReminderKind,
  lifecycleEventKey,
} from './lifecycleEmails.js';
import { sendEmail as realSendEmail } from './email.js';
import { readTrialFromPayload } from './trial-status.js';

const EVENT_TYPE_PREFIX = 'xbar.lifecycle.';

function isUniqueViolation(error) {
  return error?.code === '23505';
}

// Atomic claim. Returns { claimed: true } when this caller won the race,
// { claimed: false, alreadySent: true } when the email already went out.
export async function claimLifecycleEmail(supabase, { key, workspaceId, eventType, payload }) {
  const { error } = await supabase.from('workspace_subscription_events').insert({
    workspace_id: workspaceId || null,
    stripe_event_id: key,
    event_type: `${EVENT_TYPE_PREFIX}${eventType}`,
    payload: payload || {},
  });
  if (!error) return { claimed: true };
  if (isUniqueViolation(error)) return { claimed: false, alreadySent: true };
  throw new Error(`Could not claim lifecycle email send: ${error.message}`);
}

export async function releaseLifecycleEmail(supabase, key) {
  const { error } = await supabase.from('workspace_subscription_events').delete().eq('stripe_event_id', key);
  if (error) {
    throw new Error(`Could not release lifecycle email claim: ${error.message}`);
  }
}

// Operations contact first, owner fallback — the same recipient rule the
// daily reminder job uses.
export async function resolveLifecycleRecipient(supabase, workspaceId) {
  const [{ data: workspace }, { data: profile }] = await Promise.all([
    supabase.from('workspaces').select('id, name, owner_user_id').eq('id', workspaceId).maybeSingle(),
    supabase.from('workspace_profiles').select('operations_email').eq('workspace_id', workspaceId).maybeSingle(),
  ]);
  let email = profile?.operations_email || '';
  let userId = workspace?.owner_user_id || null;
  if (!email && userId) {
    const { data: owner } = await supabase.auth.admin.getUserById(userId);
    email = owner?.user?.email || '';
  }
  return { email, userId, ranchName: workspace?.name || '' };
}

async function sendOrRelease(supabase, { key, to, email, sendEmailFn = realSendEmail }) {
  if (!to) {
    await releaseLifecycleEmail(supabase, key);
    return { ok: false, skipped: true, message: 'No recipient email available; claim released.' };
  }
  // A THROWN send must release the claim exactly like a returned failure:
  // otherwise the claim persists, the next run reads "already sent", and the
  // email is silently burned without ever going out.
  let result;
  try {
    result = await sendEmailFn({ to, subject: email.subject, html: email.html, text: email.text });
  } catch (error) {
    await releaseLifecycleEmail(supabase, key);
    return {
      ok: false,
      message: `Email send threw; claim released for retry: ${error instanceof Error ? error.message : 'unknown error'}`,
    };
  }
  if (result.ok) {
    return { ok: true, sent: true };
  }
  // A skipped send (no provider configured) or a failed send must not keep
  // the claim: keeping it would burn the one shot at this email, and the
  // next run would believe it already went out.
  await releaseLifecycleEmail(supabase, key);
  return {
    ok: false,
    skipped: Boolean(result.skipped),
    message: result.skipped
      ? 'Email provider not configured; claim released so a later run retries.'
      : `Email send failed; claim released for retry: ${result.message}`,
  };
}

// WELCOME — called once per user from api/account/send-welcome.js. The
// workspace may not exist yet (it is created lazily on first save), so the
// claim is keyed on the USER, not the workspace.
export async function sendWelcomeForUser({ supabase, user, sendEmailFn = realSendEmail }) {
  if (!user?.id || !user?.email) {
    return { ok: false, message: 'No verified user to welcome.' };
  }
  const key = lifecycleEventKey('welcome', 'user', user.id);
  const claim = await claimLifecycleEmail(supabase, {
    key,
    workspaceId: null,
    eventType: 'welcome',
    payload: { user_id: user.id, email: user.email },
  });
  if (!claim.claimed) {
    return { ok: true, sent: false, alreadySent: true };
  }
  const recipientName = String(user.user_metadata?.full_name || user.user_metadata?.name || '')
    .trim()
    .split(' ')[0];
  const email = buildWelcomeEmail({ recipientName });
  return sendOrRelease(supabase, { key, to: user.email, email, sendEmailFn });
}

// TRIAL REMINDERS — one pass over trial workspaces. Pure selection logic
// takes explicit params; the cron wrapper supplies supabase + now.
function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function selectTrialReminders({ rows, nowIso }) {
  const selected = [];
  for (const row of rows || []) {
    const payload = row?.payload;
    // Any modern contract field opts into strict entitlement validation,
    // even when blank or incomplete; malformed records cannot fall back to
    // legacy dates. Legacy-only nested end/trial_end/start remain supported.
    const trialSlot = isRecord(payload) ? payload.trial : undefined;
    const hasModernTrial =
      isRecord(trialSlot) && ['startedAt', 'endsAt', 'plan'].some((field) => Object.hasOwn(trialSlot, field));
    if (hasModernTrial && !readTrialFromPayload(payload)) continue;
    const trialEndDate = resolveTrialEndDate(payload);
    if (!trialEndDate) continue;
    // A workspace that is paying is never a trial workspace; never email it.
    if (row?.billing_state === 'Active') continue;
    const kind = trialReminderKind({ trialEndDate, nowIso });
    if (!kind) continue;
    const dedupeKey = kind === 'ending-soon' ? trialEndDate : `${trialEndDate}:expired`;
    selected.push({
      workspaceId: row.workspace_id,
      kind,
      trialEndDate,
      daysLeft: Math.round(
        (Date.parse(`${trialEndDate}T00:00:00Z`) - Date.parse(`${nowIso.slice(0, 10)}T00:00:00Z`)) / 86_400_000,
      ),
      key: lifecycleEventKey(`trial-${kind}`, row.workspace_id, dedupeKey),
    });
  }
  return selected;
}

export async function processTrialReminders({ supabase, nowIso, sendEmailFn = realSendEmail }) {
  const { data: rows, error } = await supabase
    .from('workspace_subscription_profiles')
    .select('workspace_id, billing_state, payload')
    .order('workspace_id', { ascending: true })
    .limit(500);
  if (error) {
    throw new Error(`Could not read trial workspaces: ${error.message}`);
  }
  const selected = selectTrialReminders({ rows, nowIso: nowIso || new Date().toISOString() });
  const recipientCache = new Map();
  let emailed = 0;
  let alreadySent = 0;
  let skipped = 0;
  const failures = [];
  for (const item of selected) {
    try {
      const claim = await claimLifecycleEmail(supabase, {
        key: item.key,
        workspaceId: item.workspaceId,
        eventType: `trial-${item.kind}`,
        payload: { trial_end: item.trialEndDate, kind: item.kind },
      });
      if (!claim.claimed) {
        alreadySent += 1;
        continue;
      }
      if (!recipientCache.has(item.workspaceId)) {
        recipientCache.set(item.workspaceId, await resolveLifecycleRecipient(supabase, item.workspaceId));
      }
      const recipient = recipientCache.get(item.workspaceId);
      const email =
        item.kind === 'ending-soon'
          ? buildTrialEndingEmail({
              ranchName: recipient.ranchName,
              trialEndDate: item.trialEndDate,
              daysLeft: item.daysLeft,
            })
          : buildTrialExpiredEmail({ ranchName: recipient.ranchName });
      if (!recipient.email) {
        await releaseLifecycleEmail(supabase, item.key);
        skipped += 1;
        continue;
      }
      const result = await sendEmailFn({
        to: recipient.email,
        subject: email.subject,
        html: email.html,
        text: email.text,
      });
      if (result.ok) {
        emailed += 1;
      } else {
        await releaseLifecycleEmail(supabase, item.key);
        if (result.skipped) {
          skipped += 1;
        } else {
          failures.push({ workspaceId: item.workspaceId, kind: item.kind, message: result.message });
        }
      }
    } catch (jobError) {
      // The claim is released here too: this catch only runs when no send was
      // confirmed (a confirmed send is followed by nothing that can throw),
      // so keeping the claim would burn the email.
      await releaseLifecycleEmail(supabase, item.key).catch(() => {});
      failures.push({
        workspaceId: item.workspaceId,
        kind: item.kind,
        message: jobError instanceof Error ? jobError.message : 'Trial reminder failed.',
      });
    }
  }
  return { ok: true, checked: (rows || []).length, selected: selected.length, emailed, alreadySent, skipped, failures };
}

// DUNNING — invoice.payment_failed. One email per INVOICE (each failed
// attempt carries its own event id, but the customer gets one notice per
// invoice, not one per retry).
export async function handleInvoicePaymentFailed({
  supabase,
  stripe,
  invoice,
  eventId,
  billingPortalUrl = '',
  sendEmailFn = realSendEmail,
}) {
  const invoiceId = invoice?.id || '';
  const customerId = typeof invoice?.customer === 'string' ? invoice.customer : invoice?.customer?.id || '';
  if (!invoiceId || !customerId) {
    return { ok: false, message: 'invoice.payment_failed arrived without an invoice id or customer.' };
  }
  // Resolve the workspace: the billing-customers table first, then the
  // subscription's metadata (checkout stamps workspace_id there).
  const { data: billingCustomer } = await supabase
    .from('workspace_billing_customers')
    .select('workspace_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();
  let workspaceId = billingCustomer?.workspace_id || null;
  if (!workspaceId && invoice?.subscription && stripe) {
    try {
      const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
      if (subscriptionId) {
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        workspaceId = subscription?.metadata?.workspace_id || null;
      }
    } catch {
      // A failed lookup is not a reason to skip dunning; fall through to the
      // unresolved-workspace path below.
    }
  }
  if (!workspaceId) {
    return { ok: false, message: `Could not resolve a workspace for customer ${customerId}; dunning not sent.` };
  }
  const key = lifecycleEventKey('payment-failed', workspaceId, invoiceId);
  const claim = await claimLifecycleEmail(supabase, {
    key,
    workspaceId,
    eventType: 'payment-failed',
    payload: { invoice_id: invoiceId, customer_id: customerId, stripe_event_id: eventId || null },
  });
  if (!claim.claimed) {
    return { ok: true, sent: false, alreadySent: true };
  }
  const recipient = await resolveLifecycleRecipient(supabase, workspaceId).catch(async (lookupError) => {
    // A failed recipient lookup must not burn the claim.
    await releaseLifecycleEmail(supabase, key);
    throw new Error(
      `Could not resolve a recipient for workspace ${workspaceId}: ${lookupError instanceof Error ? lookupError.message : 'unknown error'}`,
    );
  });
  if (!recipient.email) {
    await releaseLifecycleEmail(supabase, key);
    return { ok: false, message: `No recipient email for workspace ${workspaceId}; claim released.` };
  }
  const planName = invoice?.lines?.data?.[0]?.price?.nickname || invoice?.lines?.data?.[0]?.description || '';
  const email = buildPaymentFailedEmail({ ranchName: recipient.ranchName, planName, billingPortalUrl });
  let result;
  try {
    result = await sendEmailFn({ to: recipient.email, subject: email.subject, html: email.html, text: email.text });
  } catch (sendError) {
    await releaseLifecycleEmail(supabase, key);
    return {
      ok: false,
      message: `Dunning email send threw; claim released: ${sendError instanceof Error ? sendError.message : 'unknown error'}`,
    };
  }
  if (result.ok) {
    return { ok: true, sent: true };
  }
  await releaseLifecycleEmail(supabase, key);
  return {
    ok: false,
    skipped: Boolean(result.skipped),
    message: result.skipped
      ? 'Email provider not configured; claim released so a later failed attempt retries.'
      : `Dunning email send failed; claim released: ${result.message}`,
  };
}
