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
          manualChunks(id) {
            // Supabase is large — isolate it so auth changes don't bust React cache
            if (id.includes('node_modules/@supabase')) return 'vendor-supabase';
            // Radix UI components are tree-shaken but still sizeable as a group
            if (id.includes('node_modules/@radix-ui')) return 'vendor-radix';
            // Lucide ships many icons; keep them together out of the main chunk
            if (id.includes('node_modules/lucide-react')) return 'vendor-icons';
            // Core React runtime — tiny, but isolated so it never invalidates
            if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/')) return 'vendor-react';
          },
        },
      },
    },
  };
});
