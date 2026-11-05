import { defineBaseConfig } from '@wallpaperdb/vitest-config';
export default defineBaseConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    name: 'factory-frontend',
    include: ['frontend/test/**/*.unit.test.ts', 'frontend/test/**/*.unit.test.tsx'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['frontend/src/**/*.{ts,tsx}'],
      reportsDirectory: './coverage/unit/frontend',
    },
  },
});
