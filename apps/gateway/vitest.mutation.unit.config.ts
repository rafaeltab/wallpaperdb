import { defineConfig } from 'vitest/config';
import base from './vitest.config.ts';

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    maxWorkers: 1,
    maxConcurrency: 1,
    retry: 0,
    isolate: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'mutation-unit',
          include: ['test/**/*.unit.test.ts', 'src/**/*.unit.test.ts'],
        },
      },
    ],
  },
});
