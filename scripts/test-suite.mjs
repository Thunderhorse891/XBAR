import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
// The suite exercises auth/business rules without a real Redis account. Tests
// of production limiter failures explicitly override these local-only values.
const env = { ...process.env, NODE_ENV: 'test', RATE_LIMIT_MODE: 'memory', VERCEL: '' };
const commands = JSON.parse(readFileSync('package.json', 'utf8')).scripts['test:unit'].split(' && ');
for (const command of commands) {
  const result = spawnSync(command, { shell: true, stdio: 'inherit', env });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
