import { spawnSync } from 'node:child_process';

// DATABASE_URL must name an isolated empty CI database. Never run this against
// production: ci-platform.sql deliberately creates platform fixtures and roles.
const url = process.env.TEST_DATABASE_URL;
if (!url || !['localhost', '127.0.0.1', 'postgres'].includes(new URL(url).hostname)) {
  throw new Error('TEST_DATABASE_URL must point at isolated local PostgreSQL.');
}
for (const [command, args] of [
  [process.execPath, ['scripts/prepare-supabase-schema.mjs']],
  ['psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', 'supabase/checks/ci-platform.sql']],
  ['psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', 'supabase/production-schema.generated.sql']],
  ['psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', 'supabase/checks/ci-rls.sql']],
]) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(1);
}
