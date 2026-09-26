import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['scripts/vendor/crap-typescript-core/test/**/*.test.ts', 'scripts/crap.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
