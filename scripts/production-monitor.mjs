import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function healthyCron(value, now = Date.now()) {
  return Number.isSafeInteger(value?.completedAt) && value.completedAt <= now && now - value.completedAt < 26 * 3600000;
}
export async function monitor() {
  const failures = [];
  try {
    const r = await fetch('https://xbar-horse-management-app.vercel.app/api/health', {
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok || (await r.json()).ok !== true) failures.push('Production health failed.');
  } catch {
    failures.push('Production health unreachable.');
  }
  for (const name of ['run', 'trial-reminders']) {
    try {
      const r = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(['GET', `xbar:cron:${name}`]),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok || !healthyCron(JSON.parse((await r.json()).result))) throw Error();
    } catch {
      failures.push(`${name}: no verified successful completion within 26 hours.`);
    }
  }
  try {
    const r = await fetch(
      `https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/actions/workflows/database-backup.yml/runs?branch=main&status=success&per_page=1`,
      { headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }, signal: AbortSignal.timeout(15000) },
    );
    const run = (await r.json()).workflow_runs?.[0];
    const age = Date.now() - Date.parse(run?.created_at);
    if (!r.ok || !Number.isFinite(age) || age < 0 || age > 36 * 3600000) throw Error();
  } catch {
    failures.push('No successful scheduled database backup within 36 hours.');
  }
  return failures;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const failures = await monitor();
  writeFileSync('monitor-result.json', JSON.stringify(failures));
  console.log(
    failures.length ? failures.join('\n') : 'Production health, cron completions and backup schedule passed.',
  );
  if (failures.length) process.exitCode = 1;
}
