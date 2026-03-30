import react from '@vitejs/plugin-react';
import { defineBaseConfig } from '@wallpaperdb/vitest-config';

export default defineBaseConfig({
  plugins: [react()],
  test: {
    name: 'react-muuri',
    globals: true,
    environment: 'jsdom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.d.ts', 'test/**/*.ts'],
      reportsDirectory: './coverage',
    },
  },
});
