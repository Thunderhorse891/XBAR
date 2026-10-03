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
  ['psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', 'supabase/checks/media-approval-writes.sql']],
  ['psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', 'supabase/checks/staff-writes.sql']],
  ['psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', 'supabase/checks/seat-reservation.sql']],
  ['psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', 'supabase/checks/account-deletion-request-fence.sql']],
  ['psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', 'supabase/checks/workspace-keyed-storage.sql']],
  [process.execPath, ['scripts/database-readiness.mjs', '--baseline']],
  [process.execPath, ['scripts/test-database-readiness.mjs']],
  ['psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', 'supabase/checks/ci-release-behavior.sql']],
  ['psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', 'supabase/checks/reminder-delivery.sql']],
  ['psql', [url, '-v', 'ON_ERROR_STOP=1', '-f', 'supabase/checks/ci-anon-table-access.sql']],
  [process.execPath, ['scripts/test-anon-table-access.mjs']],
]) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(1);
}
