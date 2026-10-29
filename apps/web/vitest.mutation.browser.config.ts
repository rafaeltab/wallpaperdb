import { defineConfig } from 'vitest/config';
import base from './vitest.browser.config.ts';

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    name: 'web-mutation-chromium',
    retry: 0,
    maxWorkers: 1,
    maxConcurrency: 1,
    // Native Stryker per-test counters own mutation coverage in this context.
    coverage: { ...base.test?.coverage, enabled: false },
  },
});
