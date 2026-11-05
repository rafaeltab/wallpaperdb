import { defineBaseConfig } from '@wallpaperdb/vitest-config';
export default defineBaseConfig({
  test: {
    name: 'factory-frontend-http',
    include: ['frontend/test/**/*.integration.test.ts'],
    testTimeout: 30000,
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      include: ['frontend/src/**/*.{ts,tsx}'],
      reportsDirectory: './coverage/integration/frontend',
    },
  },
});
