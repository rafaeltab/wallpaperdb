import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'ingestor',
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60000, // 60 seconds for testcontainers
    hookTimeout: 60000,
    // Enable parallel test execution within files
    maxConcurrency: 5, // Run up to 5 tests in parallel per file
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: 5,
        minThreads: 2,
      },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      reportsDirectory: '../../coverage',
    },
  },
});
