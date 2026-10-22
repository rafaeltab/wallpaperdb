import { defineConfig } from 'vitest/config';
import base from './vitest.config.js';

// Bounded driven-adapter pilot. These tests call the instrumented adapter in this
// process and use real Redis; subprocess and search suites need separate pilots.
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    projects: [
      {
        extends: true,
        test: {
          name: 'gateway-mutation-redis',
          include: ['test/redis.integration.test.ts'],
        },
      },
    ],
  },
});
