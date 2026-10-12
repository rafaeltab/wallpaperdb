import { defineBaseConfig } from '@wallpaperdb/vitest-config';

export default defineBaseConfig({
  test: {
    name: 'variant-generator',
    globals: true,
    environment: 'node',
    include: ['test/**/*.unit.test.ts'],
    testTimeout: 120000,
    hookTimeout: 60000,
    maxConcurrency: 1,
    // Keep the two-worker setting validated in #351 for the fast selection (#359).
    maxWorkers: 2,
    fileParallelism: true,
    // Environment stubs must remain isolated per file.
    isolate: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      reportsDirectory: './coverage/unit',
    },
  },
});
