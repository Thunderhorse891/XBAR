#!/usr/bin/env node
/*
 * Prove that a production bundle refuses owner test mode.
 *
 * The check is only meaningful against a build where the flag was ENABLED: that
 * is the most permissive configuration a production bundle can have, so if the
 * control is absent there it is absent in any production build. Running the
 * prod-smoke suite normally exercises the same spec against a bundle built
 * without the flag, which checks something weaker.
 *
 * This wrapper exists because setting the variable inline (`VITE_X=true npm run
 * build`) is not portable to Windows shells, and because getting the build
 * configuration wrong turns this into a test that passes for the wrong reason.
 */

import { spawnSync } from 'node:child_process';

const SPEC = 'tests/prod-smoke/owner-mode-production-block.spec.ts';

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log('Building with VITE_XBAR_LOCAL_OWNER_MODE=true (the permissive case)...');
run('npm', ['run', 'build'], { VITE_XBAR_LOCAL_OWNER_MODE: 'true' });

console.log('\nChecking that owner test mode is still absent...');
run('npx', ['playwright', 'test', '--config=playwright.prod.config.ts', SPEC]);

console.log('\nRebuilding without the flag so dist/ is left in its normal state...');
run('npm', ['run', 'build']);

console.log('\nProduction build refuses owner test mode even when the flag is set.');
