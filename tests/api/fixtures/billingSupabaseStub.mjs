/*
 * The '@supabase/supabase-js' replacement used by the billing endpoint
 * behavioral tests (see billingLoader.mjs).
 *
 * api/_lib/supabase-admin.js caches its client in module scope, so the test
 * cannot swap fakes between scenarios by re-registering. createClient
 * therefore returns a Proxy that forwards every access to the CURRENTLY
 * registered fake — the cached client keeps working while each test installs
 * its own scripted database underneath.
 *
 * A fake client:
 *
 *   {
 *     from: (table) => FakeQuery,   // chainable: select/eq/limit/update/upsert
 *     rpc: async (name, params) => ({ data, error }),
 *     auth: { getUser: async (token) => ({ data: { user }, error }) },
 *   }
 *
 * makeClient builds one from per-table handlers plus rpc/auth implementations.
 * A table handler receives (mode, ops) where mode is 'maybeSingle', 'single'
 * or 'rows' (an awaited chain), and ops is the recorded chain of
 * [method, ...args]. It returns the { data, error } the real client would.
 */

const registry = { client: null };

export function __setBillingSupabase(fake) {
  registry.client = fake;
}

function currentClient() {
  if (!registry.client) {
    throw new Error('billingSupabaseStub: no fake registered via __setBillingSupabase');
  }
  return registry.client;
}

export function createClient() {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        const value = currentClient()[prop];
        return typeof value === 'function' ? value.bind(currentClient()) : value;
      },
    },
  );
}

export class FakeQuery {
  constructor(exec) {
    this.exec = exec;
    this.ops = [];
  }

  select(columns) {
    this.ops.push(['select', columns]);
    return this;
  }

  eq(column, value) {
    this.ops.push(['eq', column, value]);
    return this;
  }

  limit(count) {
    this.ops.push(['limit', count]);
    return this;
  }

  update(values) {
    this.ops.push(['update', values]);
    return this;
  }

  upsert(values) {
    this.ops.push(['upsert', values]);
    return this;
  }

  maybeSingle() {
    return this.exec('maybeSingle', this.ops);
  }

  single() {
    return this.exec('single', this.ops);
  }

  then(resolve, reject) {
    return Promise.resolve(this.exec('rows', this.ops)).then(resolve, reject);
  }
}

export function makeClient({ tables = {}, rpcImpl = null, authImpl = null } = {}) {
  return {
    from(table) {
      const handler = tables[table];
      if (!handler) {
        throw new Error(`billingSupabaseStub: unexpected table "${table}"`);
      }
      return new FakeQuery(handler);
    },
    rpc(name, params) {
      if (!rpcImpl) {
        return Promise.reject(new Error(`billingSupabaseStub: unexpected rpc "${name}"`));
      }
      return rpcImpl(name, params);
    },
    auth: authImpl || {
      getUser: async () => ({ data: { user: null }, error: { message: 'no auth configured' } }),
    },
  };
}

/* Convenience: a table whose reads return no row and whose writes succeed. */
export function emptyTable() {
  return async (mode) => {
    if (mode === 'maybeSingle' || mode === 'single') return { data: null, error: null };
    return { data: [], error: null };
  };
}
