import { defineBaseConfig } from '@wallpaperdb/vitest-config';

// Only the in-process reader. Image subprocesses and lifetime suites stay independent.
export default defineBaseConfig({
  test: {
    name: 'asset-mutation-s3',
    environment: 'node',
    include: ['test/s3-assets.integration.test.ts'],
    testNamePattern: '^reads exact stored bytes and distinguishes missing objects$',
    setupFiles: ['./test/mutation-s3-setup.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    retry: 0,
    maxWorkers: 1,
    maxConcurrency: 1,
    isolate: true,
  },
});
