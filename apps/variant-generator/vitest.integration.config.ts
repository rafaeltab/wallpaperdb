import { defineBaseConfig } from '@wallpaperdb/vitest-config';

export default defineBaseConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 120000,
    hookTimeout: 60000,
    maxConcurrency: 1,
    maxWorkers: 1,
    fileParallelism: false,
    isolate: true,
    projects: [
      {
        test: {
          name: 'variant-generator-runtime',
          include: ['test/**/*.runtime.integration.test.ts'],
          // Retain the isolated two-worker execution validated before partitioning.
          maxWorkers: 2,
          fileParallelism: true,
          sequence: { groupOrder: 1 },
        },
      },
      {
        test: {
          name: 'variant-generator-integration',
          include: ['test/**/*.integration.test.ts'],
          exclude: ['test/**/*.runtime.integration.test.ts'],
          // Different worker budgets require distinct group orders in Vitest 5.
          sequence: { groupOrder: 2 },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      reportsDirectory: './coverage/integration',
    },
  },
});
