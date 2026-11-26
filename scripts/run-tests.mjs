import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const commands = pkg.xbarTestCommands;
if (!Array.isArray(commands) || !commands.length) throw new Error('The configured test chain is missing.');

// One bounded process per existing step avoids Windows' command-line limit.
// Invoke Node directly so neither shell quoting nor .cmd resolution can omit a
// suite. Keep the original order and stop at the first failure, like `&&` did.
const steps = commands.map((command) => {
  if (typeof command !== 'string' || !/^[A-Za-z0-9_./:= -]+$/.test(command))
    throw new Error(`Unsupported test command: ${command}`);
  const [runner, ...args] = command.split(/\s+/);
  let nodeArgs;
  if (runner === 'node') nodeArgs = args;
  else if (runner === 'tsx') nodeArgs = ['--import=tsx', ...args];
  else if (runner === 'tsc') nodeArgs = [require.resolve('typescript/bin/tsc'), ...args];
  else if (runner === 'npm' && process.env.npm_execpath) nodeArgs = [process.env.npm_execpath, ...args];
  else throw new Error(`Run the configured checks with npm test; unsupported runner: ${runner}`);
  return { command, nodeArgs };
});
for (const [index, { command, nodeArgs }] of steps.entries()) {
  console.log(`\n[tests ${index + 1}/${commands.length}] ${command}`);
  const result = spawnSync(process.execPath, nodeArgs, { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`Test step failed: ${command}${result.signal ? ` (${result.signal})` : ''}`);
    process.exit(result.status || 1);
  }
}
console.log(`\nAll ${commands.length} configured test steps passed.`);
