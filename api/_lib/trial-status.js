/*
 * The 14-day Professional trial policy (server side).
 *
 * App-side only: no Stripe trial, no card, no subscription object. A trial is
 * a record on the workspace's subscription profile —
 * `payload.trial = { startedAt, endsAt, plan }` — written by
 * `api/account/[action].js` (action `trial-start`) through the service role, because workspace users have
 * no write access to `workspace_subscription_profiles` (the owner-write policy
 * was dropped in 20260611_commercial_entitlements.sql). The client can never
 * grant itself a trial; it only asks the endpoint.
 *
 * Expiry needs no job and no second write. Every entitlement read evaluates
 * `startedAt <= now < endsAt` at that moment, so a trial lapses the instant
 * its window passes — on the API, in the database helpers, and in the app.
 *
 * The one-trial rule is enforced by the presence of the record, not by its
 * state: `hasTrialRecord` answers "did this workspace ever start one" and
 * `readTrialFromPayload` answers "is one active right now". They are different
 * questions on purpose. An expired trial must block a restart, and a malformed
 * record must block a restart without granting anything.
 */

import { isEntitledBillingState } from './subscription-status.js';

/** The only plan a trial may grant. Fixed — the endpoint never takes a tier. */
export const TRIAL_PLAN_TIER = 'Professional';

/** Trial length in days. Mirrored by src/lib/trialSubscription.ts; the
 *  client/server parity test pins the two together. */
export const TRIAL_LENGTH_DAYS = 14;

export const TRIAL_LENGTH_MS = TRIAL_LENGTH_DAYS * 24 * 60 * 60 * 1000;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseTrialDate(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : null;
}

/**
 * True when the payload carries any trial record at all — the one-trial rule.
 *
 * Deliberately looser than `readTrialFromPayload`: a hand-edited or corrupted
 * record still counts as "this workspace used its trial". It blocks a restart
 * without granting entitlements, which is the fail-closed direction for both
 * questions.
 */
export function hasTrialRecord(payload) {
  const trial = isRecord(payload) ? payload.trial : undefined;
  return isRecord(trial) && typeof trial.startedAt === 'string' && trial.startedAt.length > 0;
}

/**
 * The trial record the server honors, or null when there is nothing usable.
 *
 * Strict: the plan must be the trial plan, both timestamps must parse, and
 * the window must be well-formed. Anything else is not a trial — a payload
 * that claims 90 days of Professional is read as no trial at all.
 */
export function readTrialFromPayload(payload) {
  const trial = isRecord(payload) ? payload.trial : undefined;
  if (!isRecord(trial)) return null;
  if (trial.plan !== TRIAL_PLAN_TIER) return null;
  const startedAt = parseTrialDate(trial.startedAt);
  const endsAt = parseTrialDate(trial.endsAt);
  if (!startedAt || !endsAt) return null;
  if (endsAt.getTime() <= startedAt.getTime()) return null;
  // The server always writes exactly TRIAL_LENGTH_MS. A longer window was not
  // written by the server, so it is not honored.
  if (endsAt.getTime() - startedAt.getTime() > TRIAL_LENGTH_MS) return null;
  return { startedAt, endsAt, plan: TRIAL_PLAN_TIER };
}

/** 'active' | 'expired' | 'none' for a parsed trial record at `nowMs`. */
export function getTrialState(trial, nowMs = Date.now()) {
  if (!trial) return 'none';
  const now = Number(nowMs);
  if (!Number.isFinite(now)) return 'none';
  // A trial dated in the future has not started; it is not active yet.
  if (trial.startedAt.getTime() > now) return 'none';
  return now < trial.endsAt.getTime() ? 'active' : 'expired';
}

/** Whole days left, rounded up, or 0 when the trial is not active. */
export function trialDaysRemaining(trial, nowMs = Date.now()) {
  if (getTrialState(trial, nowMs) !== 'active') return 0;
  const remainingMs = trial.endsAt.getTime() - Number(nowMs);
  return Math.max(1, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
}

/**
 * Build the trial record the server writes on start.
 *
 * `endsAt` is always derived here, never accepted from the caller — the one
 * place the window length is decided, so no request can ask for longer.
 */
export function buildTrialRecord(nowMs = Date.now()) {
  const startedAt = new Date(nowMs).toISOString();
  const endsAt = new Date(nowMs + TRIAL_LENGTH_MS).toISOString();
  return { startedAt, endsAt, plan: TRIAL_PLAN_TIER };
}

/**
 * Whether the workspace behind `row` may start a trial, and why not.
 *
 * Pure decision, no IO — the endpoint reads the row and this decides, so the
 * rules are testable without a database.
 *
 * A workspace already entitled to paid features has nothing to trial. A
 * workspace that already carries a trial record — active, expired, or
 * malformed — may not start another. Everything else (including a lapsed
 * subscription and a brand-new workspace with no row at all) may.
 */
export function decideTrialStart(row) {
  if (hasTrialRecord(row?.payload)) {
    return {
      ok: false,
      code: 'trial_already_used',
      status: 409,
      message: 'This workspace has already used its 14-day Professional trial.',
    };
  }

  /*
   * A workspace already entitled to paid features has nothing to trial — and
   * "entitled" is a property of the billing state, not the tier.
   * entitledTierForBillingState maps ('Starter', 'Active') back to the
   * baseline tier, so keying this on the tier alone would grant a paying
   * Starter workspace a Professional trial while the SQL entitlement
   * predicates keep enforcing Starter limits: paid actions gated by a
   * divergent client decision. Reject the paid row explicitly.
   *
   * Lapsed states ('Past Due', 'Inactive', unknown) still fall through to
   * ok:true — a former customer may trial, per the contract above.
   */
  if (isEntitledBillingState(row?.billing_state)) {
    return {
      ok: false,
      code: 'already_entitled',
      status: 409,
      message: 'This workspace already has an active paid subscription, so there is no trial to start.',
    };
  }

  return { ok: true };
}

/**
 * Start the trial for a workspace: decide, then write the record.
 *
 * The update carries the same "no trial yet" condition the decision read, so
 * two concurrent starts do not both move the window — the loser sees zero
 * rows affected and is told the trial is already used instead of silently
 * restarting it.
 *
 * A failed read refuses rather than treating "no row" as "no trial": a read
 * error is not evidence the workspace never trialed, and writing over an
 * unreadable row could resurrect a trial that already expired.
 */
export async function startWorkspaceTrial(supabase, workspaceId, nowMs = Date.now()) {
  const { data: row, error: readError } = await supabase
    .from('workspace_subscription_profiles')
    .select('tier, billing_state, monthly_rate, payload')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (readError) {
    return {
      ok: false,
      code: 'subscription_unavailable',
      status: 503,
      message: 'The subscription record could not be read, so the trial was not started. Try again in a moment.',
    };
  }

  const decision = decideTrialStart(row);
  if (!decision.ok) return decision;

  const trial = buildTrialRecord(nowMs);
  const startedIso = new Date(nowMs).toISOString();
  const nextPayload = { ...(isRecord(row?.payload) ? row.payload : {}), trial };

  if (row) {
    const { data: updated, error: updateError } = await supabase
      .from('workspace_subscription_profiles')
      .update({ payload: nextPayload, updated_at: startedIso })
      .eq('workspace_id', workspaceId)
      // The race guard: only write when no trial record appeared since the read.
      .filter('payload->trial->>startedAt', 'is', null)
      .select('workspace_id');

    if (updateError) {
      return {
        ok: false,
        code: 'subscription_unavailable',
        status: 503,
        message: 'The subscription record could not be updated, so the trial was not started. Try again in a moment.',
      };
    }

    if (!Array.isArray(updated) || updated.length === 0) {
      return {
        ok: false,
        code: 'trial_already_used',
        status: 409,
        message: 'This workspace has already used its 14-day Professional trial.',
      };
    }
  } else {
    // No subscription row yet — a workspace that never touched billing. The
    // trial record rides on a baseline row so every reader sees one shape.
    const { error: insertError } = await supabase.from('workspace_subscription_profiles').insert({
      workspace_id: workspaceId,
      tier: 'Starter',
      billing_state: 'Inactive',
      monthly_rate: 0,
      payload: nextPayload,
    });

    if (insertError) {
      return {
        ok: false,
        code: 'subscription_unavailable',
        status: 503,
        message: 'The subscription record could not be created, so the trial was not started. Try again in a moment.',
      };
    }
  }

  return { ok: true, trial };
}
