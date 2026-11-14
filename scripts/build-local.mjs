import { spawn } from 'node:child_process';

const env = {
  ...process.env,
  VITE_ALLOW_LOCAL_MODE: 'true',
  VITE_ROUTER_MODE: 'browser',
  VITE_RUNTIME_MONITORING_ENABLED: 'false',
  VITE_STATIC_TARGET: 'web',
  // A preceding mobile build must not change what the web smoke suite tests.
  VITE_NATIVE_APP: 'false',
  XBAR_SKIP_MARKETING: '',
  // Explicit empty values outrank .env files in Vite. Deleting these keys
  // permits a local production .env file to re-enable real cloud accounts.
  VITE_SUPABASE_URL: '',
  VITE_SUPABASE_ANON_KEY: '',
};

const child = spawn('npm', ['run', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
