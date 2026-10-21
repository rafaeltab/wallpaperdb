import { defineBaseConfig } from '@wallpaperdb/vitest-config';

// Opt-in only: *.probe.ts is absent from all ordinary test include patterns.
export default defineBaseConfig({
  test: {
    name: 'prototype-adapter-contracts-419',
    include: ['test/prototype-adapter-contracts/*.probe.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 15000,
    hookTimeout: 60000,
    coverage: { enabled: false },
  },
});
