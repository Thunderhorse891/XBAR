// Build the web bundle for Capacitor (iOS/Android).
//
// Mobile wraps dist/index.html directly, so the marketing-site post-build
// (which replaces dist/index.html with the public homepage) must be skipped,
// and the router uses hash mode because there is no server to rewrite
// /app/* paths inside the WebView.

import { spawn } from 'node:child_process';

const env = {
  ...process.env,
  XBAR_SKIP_MARKETING: '1',
  VITE_ROUTER_MODE: 'hash',
  VITE_STATIC_TARGET: 'web',
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
