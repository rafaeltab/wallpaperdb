import { defineBaseConfig } from '@wallpaperdb/vitest-config';
export default defineBaseConfig({
  test: {
    name: 'factory-e2e',
    include: ['test/**/*.e2e.test.ts'],
    testTimeout: 30000,
    maxWorkers: 1,
  },
});
