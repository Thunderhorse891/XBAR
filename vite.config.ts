import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig(() => {
  const staticTarget = process.env.VITE_STATIC_TARGET ?? (process.env.GITHUB_ACTIONS ? 'github-pages' : 'web');
  const debugBuild = process.env.VITE_DEBUG_BUILD === 'true';

  return {
    base: staticTarget === 'github-pages' ? '/xbar-horse-management-app/' : '/',
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
    },
  };
});
