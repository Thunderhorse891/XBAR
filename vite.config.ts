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
      chunkSizeWarningLimit: 900,
      rollupOptions: {
        output: {
          // Split large, eagerly-loaded vendors out of the entry chunk to
          // improve first paint. The React runtime (react + react-dom +
          // scheduler + router) MUST stay in a single chunk — separating
          // `react` from `react-dom` crashes at runtime with
          // "Cannot read '__SECRET_INTERNALS...'" (blank white screen).
          // Dynamically-imported libraries (pdfjs, pdf-lib, tesseract) are
          // left to Vite's default so they stay in their own lazy chunks.
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              return undefined;
            }
            if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) {
              return 'react-vendor';
            }
            if (id.includes('@supabase')) {
              return 'supabase-vendor';
            }
            if (id.includes('@radix-ui')) {
              return 'radix-vendor';
            }
            return undefined;
          },
        },
      },
    },
  };
});
