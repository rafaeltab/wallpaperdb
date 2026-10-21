import { defineConfig } from 'vitest/config';

// Deliberately independent of the default suite and its retry policy.
export default defineConfig({
  test: {
    include: ['prototype-redis/**/*.test.ts'],
    maxWorkers: 1,
    fileParallelism: false,
    maxConcurrency: 1,
    retry: 0,
    coverage: { enabled: false },
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
