import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { Readable } from 'node:stream';

test('deletion refuses audit errors/empty acknowledgments before deletion and records completion durably', async () => {
  let auditResult, operations;
  globalThis.__deletionClient = {
    auth: {
      getUser: async () => ({ data: { user: { id: 'synthetic', email: 'a@example.invalid' } } }),
      admin: {
        deleteUser: async () => {
          operations.push('delete-user');
          return { error: null };
        },
      },
    },
    from(table) {
      if (table === 'account_deletion_events')
        return {
          insert(row) {
            operations.push(row.phase);
            return {
              select() {
                return {
                  single: async () => (typeof auditResult === 'function' ? auditResult(row.phase) : auditResult),
                };
              },
            };
          },
        };
      return {
        delete() {
          operations.push('memberships');
          return { eq: async () => ({ error: null }) };
        },
      };
    },
    storage: { from: () => ({ list: async () => ({ data: [] }) }) },
  };
  const base = pathToFileURL(path.resolve('api/_lib/account-delete.js'));
  const source = readFileSync(base, 'utf8').replace(/from (['"])(\.\.?\/[^'"]+)\1/g, (_m, _q, p) => {
    if (p === './supabase-admin.js')
      return 'from "data:text/javascript,export const getSupabaseAdmin=()=>globalThis.__deletionClient"';
    if (p === './account-deletion.js')
      return 'from "data:text/javascript,export const confirmationSatisfied=()=>true;export const loadAccountDeletionPlan=async()=>({workspacesToPurge:[],workspacesToTransfer:[]});export const workspacesStillPrivate=x=>x;export const documentPrefixesToPurge=()=>[];export const mediaPrefixesToPurge=()=>[]"';
    return `from '${new URL(p, base).href}'`;
  });
  const handler = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
  process.env.NODE_ENV = 'test';
  process.env.RATE_LIMIT_MODE = 'memory';
  delete process.env.VERCEL;
  const run = async () => {
    operations = [];
    const req = Readable.from(['{}']);
    Object.assign(req, { method: 'POST', headers: { authorization: 'Bearer test' } });
    const res = {
      setHeader() {},
      end(p) {
        this.body = JSON.parse(p);
      },
    };
    await handler(req, res);
    return res;
  };
  for (const failure of [{ error: { message: 'offline' } }, { data: null, error: null }]) {
    auditResult = failure;
    const r = await run();
    assert.equal(r.statusCode, 503);
    assert.equal(operations.includes('delete-user'), false);
    assert.equal(operations.includes('memberships'), false);
  }
  auditResult = { data: { id: 'receipt' }, error: null };
  const r = await run();
  assert.equal(r.statusCode, 200);
  assert.deepEqual(operations, ['started', 'memberships', 'delete-user', 'completed']);
  auditResult = (phase) => (phase === 'started' ? { data: { id: 'receipt' } } : { error: { message: 'offline' } });
  const incomplete = await run();
  assert.equal(incomplete.statusCode, 503);
  assert.equal(incomplete.body.code, 'deletion_audit_incomplete');
  assert.ok(incomplete.body.operationId);
  assert.deepEqual(operations, ['started', 'memberships', 'delete-user', 'completed', 'failed']);
});
