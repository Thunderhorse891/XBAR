import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(() => {
  const staticTarget = process.env.VITE_STATIC_TARGET ?? (process.env.GITHUB_ACTIONS ? 'github-pages' : 'web');
  const debugBuild = process.env.VITE_DEBUG_BUILD === 'true';

  return {
    base: staticTarget === 'github-pages' ? '/XBAR/' : '/',
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    server: {
      port: 5173,
      host: true,
      strictPort: true,
    },
    clearScreen: false,
    envPrefix: ['VITE_'],
    build: {
      target: ['es2021', 'chrome100', 'safari13'],
      minify: debugBuild ? false : 'esbuild',
      sourcemap: debugBuild,
      // Raise the size-warning threshold only. Do NOT add a manualChunks split
      // that separates `react` from `react-dom` — it crashes the app at runtime
      // with "Cannot read '__SECRET_INTERNALS...'" (blank white screen). Vite's
      // default chunking keeps React and React-DOM together.
      chunkSizeWarningLimit: 900,
    },
  };
});
