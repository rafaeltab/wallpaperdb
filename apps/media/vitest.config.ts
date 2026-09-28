import { defineBaseConfig } from '@wallpaperdb/vitest-config';

export default defineBaseConfig({
  test: {
    name: 'media',
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60000, // 60 seconds for testcontainers
    hookTimeout: 60000,
    // Enable parallel test execution within files
    maxConcurrency: 5, // Run up to 5 tests in parallel per file
    maxWorkers: 5,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      reportsDirectory: './coverage/integration',
    },
  },
});
