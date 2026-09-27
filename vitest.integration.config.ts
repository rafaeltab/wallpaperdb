import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'repository-integration',
    include: ['test/integration/**/*.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
