import { defineBaseConfig } from '@wallpaperdb/vitest-config';

// One publication/replay operation. Configuration and lifetime cases stay independent.
export default defineBaseConfig({
  test: {
    name: 'color-extractor-mutation-nats',
    environment: 'node',
    include: ['test/events.integration.test.ts'],
    testNamePattern: '^awaits durable publication and preserves occurrence identity on replay$',
    setupFiles: ['./test/mutation-nats-setup.ts'],
    testTimeout: 10000,
    hookTimeout: 10000,
    retry: 0,
    maxWorkers: 1,
    maxConcurrency: 1,
    isolate: true,
  },
});
