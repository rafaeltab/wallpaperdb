import { defineConfig } from 'vitest/config';
import base from './vitest.config.ts';

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    projects: [
      {
        extends: true,
        test: {
          name: 'web-mutation-node',
          environment: 'node',
          include: ['test/**/*.test.ts', 'test/**/*.test.tsx', 'src/**/*.test.ts'],
          exclude: ['test/**/*.dom.test.ts', 'test/**/*.dom.test.tsx'],
          retry: 0,
          maxWorkers: 1,
          maxConcurrency: 1,
        },
      },
    ],
  },
});
