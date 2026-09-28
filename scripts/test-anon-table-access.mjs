import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { databaseEnv } from './database-backup.mjs';

const url = process.env.TEST_DATABASE_URL;
if (!url || !['127.0.0.1', 'localhost', 'postgres'].includes(new URL(url).hostname)) {
  throw new Error('Grant regression tests require isolated local PostgreSQL.');
}
const migration = readFileSync('supabase/migrations/20260928150000_restrict_anon_table_discovery.sql', 'utf8')
  .replace(/\r/g, '')
  .replace(/^begin;$/m, '')
  .replace(/^commit;$/m, '');
for (const [grants, allowed] of [
  ['grant select on public.anon_acl_probe to anon;', true],
  ['grant select(id) on public.anon_acl_probe to anon;', true],
  ['grant all privileges on public.anon_acl_probe to anon;', true],
  ['grant update(id), insert(id), references(id) on public.anon_acl_probe to anon;', true],
  ['grant select on public.anon_acl_probe to public;', true],
  ['grant all privileges on public.anon_acl_probe to public;', true],
  [
    'revoke select on public.anon_acl_probe from authenticated; grant select on public.anon_acl_probe to public;',
    false,
  ],
  [
    'revoke select on public.anon_acl_probe from authenticated, service_role; grant select(id) on public.anon_acl_probe to public;',
    false,
  ],
  [
    'revoke update on public.anon_acl_probe from authenticated; grant update on public.anon_acl_probe to public;',
    false,
  ],
  [
    'revoke insert on public.anon_acl_probe from authenticated; grant insert(id) on public.anon_acl_probe to public;',
    false,
  ],
]) {
  const input = `begin;
    create table public.anon_acl_probe(id integer);
    ${grants}
    ${migration}
    ${migration}
    do $$ begin
      if exists(select 1 from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p where has_table_privilege('anon','public.anon_acl_probe',p))
      or exists(select 1 from unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) p where has_any_column_privilege('anon','public.anon_acl_probe',p))
      then raise exception 'anon privilege survived'; end if;
      if not has_table_privilege('authenticated','public.anon_acl_probe','SELECT')
      or not has_table_privilege('service_role','public.anon_acl_probe','SELECT')
      then raise exception 'intended role lost SELECT'; end if;
    end $$;
    rollback;`;
  const result = spawnSync('psql', ['-XqAt', '-v', 'ON_ERROR_STOP=1'], {
    input,
    env: databaseEnv(url),
    encoding: 'utf8',
    timeout: 30000,
  });
  if (allowed) assert.equal(result.status, 0, result.stderr);
  else {
    assert.notEqual(result.status, 0, 'unsafe inherited access must abort');
    assert.match(result.stderr, /Intended access changed for public.anon_acl_probe/);
  }
}
console.log(
  'Anonymous table migration: direct, column and inherited grants, repeat application and intended-role preservation verified.',
);
