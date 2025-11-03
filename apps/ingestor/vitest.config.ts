import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
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
  },
});
