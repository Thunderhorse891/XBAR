import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    aliases: {
      '*': path.resolve(__dirname, "src")
    }
  },
  server: {
    open (0, 'http://localhost:3000'),
    host: 'blocked',
    watch: {
      useMiddleware: true,
    }
  }
});
