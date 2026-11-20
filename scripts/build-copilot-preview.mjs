import { build } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { copyFile, mkdir, rename } from 'node:fs/promises';

// No environment files, serverless functions, auth bootstrap or payment code enter this preview.
const outDir = process.argv[2] ?? 'dist-copilot-preview';
if (!['dist-copilot-preview', 'preview/dist'].includes(outDir))
  throw new Error('Unsupported preview output directory.');
await build({
  configFile: false,
  envDir: false,
  publicDir: false,
  plugins: [react()],
  resolve: { alias: { '@': path.resolve('src') } },
  build: { outDir, emptyOutDir: true, rollupOptions: { input: path.resolve('copilot-preview.html') } },
});
await rename(`${outDir}/copilot-preview.html`, `${outDir}/index.html`);
await mkdir(`${outDir}/brand`, { recursive: true });
await copyFile('public/brand/xbar-original-lockup-480.png', `${outDir}/brand/xbar-original-lockup-480.png`);
await copyFile('preview/vercel.json', `${outDir}/vercel.json`);
console.log('Built isolated synthetic preview: no network connections, auth or checkout.');
