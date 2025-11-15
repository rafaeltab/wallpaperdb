import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Temporarily disabled during migration to TesterBuilder pattern
    // setupFiles: ['./test/setup.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    fileParallelism: false,
    // Retry tests that fail due to Docker/infrastructure timeouts
    // Common with NATS connection timing issues in CI/resource-constrained environments
    retry: 2,
  },
});
