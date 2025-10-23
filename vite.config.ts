import { defineConfig } from 'vite';
import react from 'react';

export default defineConfig({
  base: '.',
  resolve: {
    externals: ['http', 'https']
  },
  server: {
    open: true,
    host: 'localhost',
    port: 3000,
  },
});