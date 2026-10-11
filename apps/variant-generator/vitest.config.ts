import { defineBaseConfig } from '@wallpaperdb/vitest-config';

export default defineBaseConfig({
  test: {
    name: 'variant-generator',
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: [
      'test/**/*.integration.test.ts',
      'test/integration/**/*.test.ts',
      'test/health.test.ts',
    ],
    testTimeout: 120000,
    hookTimeout: 60000,
    maxConcurrency: 1,
    // Two workers overlap socket/telemetry waits while bounding memory use (#351).
    maxWorkers: 2,
    fileParallelism: true,
    // Environment stubs and telemetry SDK globals must remain isolated per file.
    isolate: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      reportsDirectory: './coverage/unit',
    },
  },
});
