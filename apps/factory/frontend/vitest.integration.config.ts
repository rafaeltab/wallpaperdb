import { fileURLToPath } from 'node:url';
import { defineBaseConfig } from '@wallpaperdb/vitest-config';
export default defineBaseConfig({
  test: {
    name: 'factory-frontend-http',
    include: ['frontend/test/**/*.integration.test.ts'],
    testTimeout: 30000,
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: [
        ['lcov', { projectRoot: fileURLToPath(new URL('../../../', import.meta.url)) }],
        'json',
        'json-summary',
      ],
      include: ['frontend/src/**/*.{ts,tsx}'],
      reportsDirectory: './coverage/integration/frontend',
    },
  },
});
