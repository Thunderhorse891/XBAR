import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { Readable } from 'node:stream';

// Run the real handlers, replacing only authenticated workspace lookup and
// downstream entitlement IO. Any privileged DB call before a denial is counted.
let calls = 0;
globalThis.__readinessAccess = {
  ok: true,
  role: 'Viewer',
  user: { id: 'user' },
  supabase: {
    from() {
      calls++;
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: null }),
      };
    },
  },
};
async function load(file) {
  const base = pathToFileURL(path.resolve(file));
  const source = readFileSync(file, 'utf8').replace(/from (['"])(\.\.?\/[^'"]+)\1/g, (_m, _q, relative) => {
    const url = new URL(relative, base);
    if (url.pathname.endsWith('/supabase-admin.js'))
      return 'from "data:text/javascript,export const requireWorkspaceAccess=async()=>globalThis.__readinessAccess"';
    if (url.pathname.endsWith('/entitlements.js'))
      return `from "data:text/javascript,export const getWorkspaceEntitlements=async()=>({ok:false,status:418,message:'reached entitlement gate'});export const checkSalePacketCapacity=()=>{};export const checkStorageCapacity=()=>{};export const checkDocumentCapacity=()=>{};export const checkHorseCapacity=()=>{};export const tierIncludesPlan=()=>true"`;
    return `from '${url.href}'`;
  });
  return (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
}
const handlers = await Promise.all(
  ['api/sale-packets.js', 'api/_lib/documents-generate-template.js', 'api/_lib/documents-bulk-upload.js'].map(load),
);
const bodies = [
  { workspaceId: 'w', horseId: 'h', buyerEmail: 'buyer@example.invalid' },
  { workspaceId: 'w', horseId: 'h', templateId: 'bill-of-sale', output: 'html' },
  { workspaceId: 'w', mode: 'preview', files: [{ fileName: 'a.txt', providedText: 'Horse' }] },
];
async function invoke(handler, body) {
  const req = Readable.from([JSON.stringify(body)]);
  Object.assign(req, { method: 'POST', headers: {}, url: '/api/test' });
  const res = {
    setHeader() {},
    end(body) {
      this.body = JSON.parse(body);
    },
  };
  await handler(req, res);
  return res;
}
test('all three privileged handlers reject absent/unknown roles before IO, and honor capability differences', async () => {
  process.env.NODE_ENV = 'test';
  process.env.RATE_LIMIT_MODE = 'memory';
  delete process.env.VERCEL;
  for (const role of ['Viewer', 'unknown', undefined])
    for (let i = 0; i < handlers.length; i++) {
      globalThis.__readinessAccess.role = role;
      calls = 0;
      const result = await invoke(handlers[i], bodies[i]);
      assert.equal(result.statusCode, 403, `${i}: ${role} must be refused`);
      assert.equal(calls, 0);
    }
  globalThis.__readinessAccess.role = 'Owner';
  assert.equal((await invoke(handlers[0], bodies[0])).statusCode, 403);
  assert.equal((await invoke(handlers[1], bodies[1])).statusCode, 418);
  assert.equal((await invoke(handlers[2], bodies[2])).statusCode, 418);
  assert.equal((await invoke(handlers[2], { ...bodies[2], mode: 'auto' })).statusCode, 403);
  assert.equal(
    (await invoke(handlers[2], { workspaceId: 'w', mode: 'commit', assignments: [{ action: 'create-horse' }] }))
      .statusCode,
    403,
  );
  globalThis.__readinessAccess.role = 'Sales Lead';
  assert.equal((await invoke(handlers[0], bodies[0])).statusCode, 418);
  globalThis.__readinessAccess.role = 'Admin';
  assert.equal((await invoke(handlers[2], { ...bodies[2], mode: 'auto' })).statusCode, 418);
});
