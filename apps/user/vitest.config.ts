import { defineBaseConfig } from '@wallpaperdb/vitest-config';

export default defineBaseConfig({
  test: {
    name: 'user',
    globals: true,
    environment: 'node',
    projects: [
      {
        extends: true,
        test: { name: 'user-unit', include: ['test/**/*.unit.test.ts'] },
      },
      {
        extends: true,
        test: {
          name: 'user-integration',
          include: ['test/**/*.integration.test.ts'],
        },
      },
    ],
    testTimeout: 60000,
    hookTimeout: 60000,
    maxConcurrency: 5,
    maxWorkers: 5,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      reportsDirectory: './coverage/integration',
    },
  },
});
