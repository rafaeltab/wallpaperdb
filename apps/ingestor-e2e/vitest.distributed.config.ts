import { defineConfig } from 'vitest/config';

/**
 * Separate vitest config for distributed rate limiting tests
 * These tests start their own infrastructure (3 ingestors + Redis)
 * and should NOT use the global setup.ts
 */
export default defineConfig({
  test: {
    // No setupFiles - this test manages its own setup
    testTimeout: 120000, // 2 minutes per test
    hookTimeout: 180000, // 3 minutes for beforeAll/afterAll
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    fileParallelism: false,
    include: ['test/rate-limiting-distributed.e2e.test.ts'],
    // Retry tests that fail due to Docker/infrastructure timeouts
    // Common with NATS connection timing issues and Docker resource constraints in CI
    retry: 2,
  },
});
