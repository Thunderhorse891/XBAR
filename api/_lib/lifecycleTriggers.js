// Lifecycle email triggers: idempotent, DB-backed orchestration for the
// templates in ./lifecycleEmails.js.
//
// IDEMPOTENCY WITHOUT A MIGRATION
//
// Every lifecycle email is claimed by inserting a row into
// `workspace_subscription_events` with a synthetic `stripe_event_id` of the
// form `xbar:lifecycle:<kind>:<workspace-or-user>:<dedupe-key>`. That column
// is UNIQUE, so the claim is atomic: a 23505 conflict means the email was
// accepted or in progress. Acceptance is recorded separately in payload.
// Only a skipped request or explicit provider rejection releases the claim.
// Transport failures/5xx can happen after acceptance: retain those claims
// for operator reconciliation rather than risk duplicate mail.
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
import { invoiceSubscriptionId } from './stripe-objects.js';

const EVENT_TYPE_PREFIX = 'xbar.lifecycle.';

function isUniqueViolation(error) {
  return error?.code === '23505';
}

// A UNIQUE conflict alone proves only that a request was claimed, not sent.
// Legacy claims without a delivery state are also uncertain and fail closed.
export async function claimLifecycleEmail(supabase, { key, workspaceId, eventType, payload }) {
  const { data, error } = await supabase
    .from('workspace_subscription_events')
    .insert({
      workspace_id: workspaceId || null,
      stripe_event_id: key,
      event_type: `${EVENT_TYPE_PREFIX}${eventType}`,
      payload: { ...payload, delivery_state: 'pending' },
    })
    .select('stripe_event_id')
    .single();
  if (!error && data?.stripe_event_id === key) return { claimed: true };
  if (isUniqueViolation(error)) {
    const { data: prior, error: readError } = await supabase
      .from('workspace_subscription_events')
      .select('stripe_event_id, payload')
      .eq('stripe_event_id', key)
      .maybeSingle();
    if (readError || prior?.stripe_event_id !== key) throw new Error('Could not verify lifecycle email claim.');
    const alreadySent = prior.payload?.delivery_state === 'accepted';
    return { claimed: false, alreadySent, pending: !alreadySent };
  }
  throw new Error(`Could not claim lifecycle email send: ${error?.message || 'insert returned no matching row'}`);
}

export async function releaseLifecycleEmail(supabase, key) {
  const { data, error } = await supabase
    .from('workspace_subscription_events')
    .delete()
    .eq('stripe_event_id', key)
    .eq('payload->>delivery_state', 'pending')
    .select('stripe_event_id');
  if (error || data?.length !== 1 || data[0].stripe_event_id !== key) {
    throw new Error(`Could not release lifecycle email claim: ${error?.message || 'no matching pending row'}`);
  }
}

function existingClaimResult(claim) {
  return claim.alreadySent
    ? { ok: true, sent: false, alreadySent: true }
    : {
        ok: false,
        sent: false,
        pending: true,
        message: 'Email delivery is pending or uncertain; reconcile the provider result before retrying.',
      };
}

async function recordAcceptance(supabase, key) {
  const { data: prior, error: readError } = await supabase
    .from('workspace_subscription_events')
    .select('payload')
    .eq('stripe_event_id', key)
    .maybeSingle();
  if (readError || prior?.payload?.delivery_state !== 'pending')
    throw new Error('Pending email claim could not be verified.');
  const { data, error } = await supabase
    .from('workspace_subscription_events')
    .update({ payload: { ...prior.payload, delivery_state: 'accepted', accepted_at: new Date().toISOString() } })
    .eq('stripe_event_id', key)
    .eq('payload->>delivery_state', 'pending')
    .select('stripe_event_id');
  if (error || data?.length !== 1 || data[0].stripe_event_id !== key)
    throw new Error('Email acceptance could not be saved.');
}

// Operations contact first, owner fallback — the same recipient rule the
// daily reminder job uses.
export async function resolveLifecycleRecipient(supabase, workspaceId) {
  const [{ data: workspace, error: workspaceError }, { data: profile, error: profileError }] = await Promise.all([
    supabase.from('workspaces').select('id, name, owner_user_id').eq('id', workspaceId).maybeSingle(),
    supabase.from('workspace_profiles').select('operations_email').eq('workspace_id', workspaceId).maybeSingle(),
  ]);
  if (workspaceError || profileError) throw new Error('Could not read the lifecycle email recipient.');
  let email = profile?.operations_email || '';
  let userId = workspace?.owner_user_id || null;
  if (!email && userId) {
    const { data: owner, error: ownerError } = await supabase.auth.admin.getUserById(userId);
    if (ownerError) throw new Error('Could not read the lifecycle email owner.');
    email = owner?.user?.email || '';
  }
  return { email, userId, ranchName: workspace?.name || '' };
}

async function sendOrRelease(supabase, { key, to, email, sendEmailFn = realSendEmail }) {
  if (!to) {
    await releaseLifecycleEmail(supabase, key);
    return { ok: false, skipped: true, message: 'No recipient email available; claim released.' };
  }
  let result;
  try {
    result = await sendEmailFn({ to, subject: email.subject, html: email.html, text: email.text });
    if (result?.ok) {
      await recordAcceptance(supabase, key);
      return { ok: true, sent: true };
    }
  } catch {
    // No receipt is not proof of no send. This also covers accepted mail whose
    // database receipt failed; never reopen that claim for automatic retries.
    return existingClaimResult({ pending: true });
  }
  if (!result?.skipped && !result?.rejected && !result?.retryable) {
    return existingClaimResult({ pending: true });
  }
  await releaseLifecycleEmail(supabase, key);
  return {
    ok: false,
    skipped: Boolean(result.skipped),
    message: result.skipped
      ? 'Email was not sent; claim released so a later run can retry.'
      : `Email request was rejected; claim released for retry: ${result.message}`,
  };
}

// WELCOME — called once per user from api/account/[action].js (action `send-welcome`). The
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
    return existingClaimResult(claim);
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
    // A trial OBJECT is governed by the strict trial contract — the same one
    // entitlement evaluation uses (plan, both timestamps, window length) — but
    // only when it claims the modern record shape ({ startedAt, endsAt, plan },
    // written by the trial mechanics). Legacy trial objects ({ end, trial_end,
    // start }) predate the mechanics and keep their historical reminder
    // behavior. A modern-shaped record that fails the contract is not a trial,
    // so it must not schedule reminders even though its endsAt looks plausible.
    // Rows with no trial object keep the legacy date-field behavior below.
    const MODERN_TRIAL_KEYS = ['startedAt', 'endsAt', 'plan'];
    const trialSlot = isRecord(payload) ? payload.trial : undefined;
    const isModernTrial = isRecord(trialSlot) && MODERN_TRIAL_KEYS.some((key) => trialSlot[key] !== undefined);
    if (isModernTrial && !readTrialFromPayload(payload)) continue;
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
        const prior = existingClaimResult(claim);
        if (prior.alreadySent) alreadySent += 1;
        else failures.push({ workspaceId: item.workspaceId, kind: item.kind, message: prior.message });
        continue;
      }
      let recipient;
      let email;
      try {
        if (!recipientCache.has(item.workspaceId)) {
          recipientCache.set(item.workspaceId, await resolveLifecycleRecipient(supabase, item.workspaceId));
        }
        recipient = recipientCache.get(item.workspaceId);
        email =
          item.kind === 'ending-soon'
            ? buildTrialEndingEmail({
                ranchName: recipient.ranchName,
                trialEndDate: item.trialEndDate,
                daysLeft: item.daysLeft,
              })
            : buildTrialExpiredEmail({ ranchName: recipient.ranchName });
      } catch (lookupError) {
        // We own this claim and no send has started. Only this case is safe
        // to release; the outer catch must never release another worker's row.
        await releaseLifecycleEmail(supabase, item.key);
        throw lookupError;
      }
      const result = await sendOrRelease(supabase, { key: item.key, to: recipient.email, email, sendEmailFn });
      if (result.sent) emailed += 1;
      else if (result.alreadySent) alreadySent += 1;
      else if (result.skipped) skipped += 1;
      else failures.push({ workspaceId: item.workspaceId, kind: item.kind, message: result.message });
    } catch (jobError) {
      failures.push({
        workspaceId: item.workspaceId,
        kind: item.kind,
        message: jobError instanceof Error ? jobError.message : 'Trial reminder failed.',
      });
    }
  }
  return {
    ok: failures.length === 0,
    checked: (rows || []).length,
    selected: selected.length,
    emailed,
    alreadySent,
    skipped,
    failures,
  };
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
  // invoiceSubscriptionId reads the current location
  // (parent.subscription_details.subscription) as well as the pre-2025
  // `invoice.subscription`, which a current payload no longer carries.
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!workspaceId && subscriptionId && stripe) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      workspaceId = subscription?.metadata?.workspace_id || null;
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
    return existingClaimResult(claim);
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
  return sendOrRelease(supabase, { key, to: recipient.email, email, sendEmailFn });
}
