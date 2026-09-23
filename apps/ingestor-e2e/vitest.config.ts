import { defineBaseConfig } from '@wallpaperdb/vitest-config';

export default defineBaseConfig({
  test: {
    name: 'ingestor-e2e',
    testTimeout: 15000,
    hookTimeout: 120000,
    fileParallelism: false,
    maxWorkers: 1,
    include: ['test/**/*.e2e.test.ts'],
  },
});
