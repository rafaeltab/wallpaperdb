import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  optimizeDeps: {
    include: [
      '@tanstack/react-router',
      'react-markdown',
      'rehype-sanitize',
      'remark-gfm',
      'graphql-request',
      '@wallpaperdb/react-muuri > muuri',
    ],
  },
  test: {
    name: 'picture-browser-contracts',
    include: ['test/browser/*.spec.{ts,tsx}'],
    testTimeout: 10000,
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/features/picture-editor/**/*.ts', 'src/components/profile/**/*.tsx'],
      reporter: ['json', 'lcov', 'json-summary'],
      reportsDirectory: './coverage/integration',
    },
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
});
