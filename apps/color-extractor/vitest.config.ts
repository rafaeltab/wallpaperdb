import { defineBaseConfig } from '@wallpaperdb/vitest-config';

export default defineBaseConfig({
  test: {
    name: 'color-extractor',
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 120000,
    hookTimeout: 60000,
    maxConcurrency: 5,
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: 5,
        minThreads: 2,
      },
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      reportsDirectory: './coverage',
    },
  },
});
