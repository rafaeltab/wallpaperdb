import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'variant-generator',
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 120000, // 120 seconds for testcontainers + image processing
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
      reportsDirectory: './coverage',
    },
  },
});
