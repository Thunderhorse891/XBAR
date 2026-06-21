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
      rollupOptions: {
        output: {
          // Split heavy, rarely-changing dependencies into long-cacheable
          // vendor chunks so first paint stays fast and repeat visits hit cache.
          manualChunks(id) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('pdfjs-dist') || id.includes('pdf-lib')) return 'vendor-pdf';
            if (id.includes('tesseract.js')) return 'vendor-ocr';
            if (id.includes('@supabase')) return 'vendor-supabase';
            if (id.includes('@radix-ui') || id.includes('cmdk') || id.includes('vaul')) return 'vendor-ui';
            if (id.includes('react-router')) return 'vendor-router';
            if (
              id.includes('/react/') ||
              id.includes('/react-dom/') ||
              id.includes('/scheduler/') ||
              id.includes('react/jsx-runtime')
            ) {
              return 'vendor-react';
            }
            return 'vendor';
          },
        },
      },
    },
  };
});
