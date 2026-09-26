/*
 * Scripted Supabase admin boundary for the trial endpoint tests.
 *
 * The tests drive the real handlers in api/_lib/account-trial-start.js and
 * api/_lib/reminders-trial.js; only the database/auth boundary is scripted.
 * Configure per test with __setTrialBoundary(scenario):
 *
 *   {
 *     access: { ok, status?, message?, role? },   // requireWorkspaceAccess result
 *     admin: 'fake' | null,                       // getSupabaseAdmin() return
 *     row: object | null,                         // subscription profile row read
 *     readError: Error-like | null,
 *     updated: array | null,                      // rows returned by the trial UPDATE
 *     updateError: Error-like | null,
 *     insertError: Error-like | null,
 *     listRows: array | null,                     // rows for the reminders scan
 *     listError: Error-like | null,
 *   }
 *
 * The fake records every call it receives so tests can assert the handler
 * asked for the right thing (and nothing more) — a handler that silently
 * skipped the race-guard filter or read the wrong row would show up here.
 */

const scenario = {
  access: { ok: false, status: 401, message: 'Missing workspace access token.' },
  admin: 'fake',
  row: null,
  readError: null,
  updated: null,
  updateError: null,
  insertError: null,
  listRows: [],
  listError: null,
};

export const calls = {
  requireWorkspaceAccess: [],
  getSupabaseAdmin: 0,
  db: [],
  reset() {
    this.requireWorkspaceAccess = [];
    this.getSupabaseAdmin = 0;
    this.db = [];
  },
};

export function __setTrialBoundary(next) {
  Object.assign(scenario, {
    access: { ok: false, status: 401, message: 'Missing workspace access token.' },
    admin: 'fake',
    row: null,
    readError: null,
    updated: null,
    updateError: null,
    insertError: null,
    listRows: [],
    listError: null,
  });
  Object.assign(scenario, next || {});
  calls.reset();
}

function recordCall(entry) {
  calls.db.push(entry);
}

class ProfilesQuery {
  constructor() {
    this.steps = [];
    this.patch = null;
    this.inserted = null;
  }

  select(columns) {
    this.steps.push({ op: 'select', columns });
    // After an update(), .select() is the terminal that returns the rows.
    if (this.patch) {
      recordCall({ table: 'workspace_subscription_profiles', steps: this.steps, patch: this.patch });
      if (scenario.updateError) return { data: null, error: scenario.updateError };
      const updated = scenario.updated !== null ? scenario.updated : [{ workspace_id: 'ws_1' }];
      return { data: updated, error: null };
    }
    return this;
  }

  eq(column, value) {
    this.steps.push({ op: 'eq', column, value });
    return this;
  }

  filter(column, operator, value) {
    this.steps.push({ op: 'filter', column, operator, value });
    return this;
  }

  order(column, options) {
    this.steps.push({ op: 'order', column, options });
    return this;
  }

  limit(count) {
    this.steps.push({ op: 'limit', count });
    recordCall({ table: 'workspace_subscription_profiles', steps: this.steps });
    if (scenario.listError) return { data: null, error: scenario.listError };
    return { data: scenario.listRows, error: null };
  }

  maybeSingle() {
    this.steps.push({ op: 'maybeSingle' });
    recordCall({ table: 'workspace_subscription_profiles', steps: this.steps });
    if (scenario.readError) return { data: null, error: scenario.readError };
    return { data: scenario.row, error: null };
  }

  update(patch) {
    this.patch = patch;
    this.steps.push({ op: 'update' });
    return this;
  }

  insert(row) {
    this.inserted = row;
    this.steps.push({ op: 'insert' });
    recordCall({ table: 'workspace_subscription_profiles', steps: this.steps, inserted: row });
    if (scenario.insertError) return { error: scenario.insertError };
    return { error: null };
  }
}

function makeFakeAdmin() {
  return {
    from(table) {
      if (table !== 'workspace_subscription_profiles') {
        throw new Error(`trial stub: unexpected table ${table}`);
      }
      return new ProfilesQuery();
    },
  };
}

export function getSupabaseAdmin() {
  calls.getSupabaseAdmin += 1;
  if (scenario.admin === null) return null;
  return makeFakeAdmin();
}

export async function requireWorkspaceAccess(accessToken, workspaceId) {
  calls.requireWorkspaceAccess.push({ accessToken, workspaceId });
  return scenario.access;
}
