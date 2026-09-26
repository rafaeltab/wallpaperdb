import { defineBaseConfig } from '@wallpaperdb/vitest-config';

export default defineBaseConfig({
  test: {
    name: 'tags-integration',
    globals: true,
    environment: 'node',
    include: ['test/**/*.integration.test.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
    maxConcurrency: 1,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      reportsDirectory: './coverage/integration',
    },
  },
});
