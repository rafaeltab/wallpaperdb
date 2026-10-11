import { defineBaseConfig } from '@wallpaperdb/vitest-config';

export const configuration = {
  test: {
    name: 'user',
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    maxConcurrency: 5,
    maxWorkers: 5,
    coverage: {
      provider: 'v8',
      autoAttachSubprocess: true,
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      reportsDirectory: './coverage/integration',
    },
  },
} satisfies Parameters<typeof defineBaseConfig>[0];

export default defineBaseConfig(configuration);
