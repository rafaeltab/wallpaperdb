import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  test: {
    name: 'picture-browser-contracts',
    include: ['test/browser/*.spec.ts'],
    testTimeout: 10000,
    coverage: {
      enabled: true,
      provider: 'v8',
      include: ['src/features/picture-editor/**/*.ts'],
      reporter: ['json', 'lcov', 'json-summary'],
      reportsDirectory: './coverage/integration',
    },
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
});
