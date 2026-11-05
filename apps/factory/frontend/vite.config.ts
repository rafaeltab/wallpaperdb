import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Only the development proxy translates a verified dev-page Origin. Production
// receives the browser Origin unchanged and retains the backend's strict check.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  build: { outDir: '../dist/frontend', emptyOutDir: true },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: process.env.FACTORY_BACKEND_URL ?? 'http://127.0.0.1:9400',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (outgoing, incoming) => {
            const origin = incoming.headers.origin;
            const expected = `http://${incoming.headers.host}`;
            if (origin === expected) {
              outgoing.setHeader('origin', `http://${outgoing.getHeader('host')}`);
            }
          });
        },
      },
    },
  },
});
