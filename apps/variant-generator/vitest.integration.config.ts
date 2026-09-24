import { defineBaseConfig } from '@wallpaperdb/vitest-config';

export default defineBaseConfig({
  test: {
    name: 'variant-generator-integration',
    globals: true,
    environment: 'node',
    include: ['test/**/*.integration.test.ts', 'test/integration/**/*.test.ts', 'test/health.test.ts'],
    testTimeout: 120000,
    hookTimeout: 60000,
    maxConcurrency: 1,
    maxWorkers: 1,
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      reportsDirectory: './coverage/integration',
    },
  },
});
