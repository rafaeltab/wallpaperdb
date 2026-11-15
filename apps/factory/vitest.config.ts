import { defineBaseConfig } from '@wallpaperdb/vitest-config';
import { availableParallelism } from 'node:os';

export const configuration = {
  test: {
    name: 'factory',
    globals: true,
    environment: 'node',
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.e2e.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
    maxConcurrency: 5,
    // Adapter contracts also need CPU capacity for Git and protocol subprocesses.
    maxWorkers: Math.max(1, Math.min(5, Math.floor(availableParallelism() / 2))),
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
