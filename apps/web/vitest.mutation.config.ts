import { configDefaults, defineConfig } from 'vitest/config';
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
          exclude: [...configDefaults.exclude, 'test/**/*.dom.test.ts', 'test/**/*.dom.test.tsx'],
          retry: 0,
          maxWorkers: 1,
          maxConcurrency: 1,
        },
      },
      {
        extends: true,
        test: {
          name: 'web-mutation-dom',
          environment: 'jsdom',
          include: ['test/**/*.dom.test.ts', 'test/**/*.dom.test.tsx'],
          setupFiles: ['./test/setup.ts'],
          retry: 0,
          maxWorkers: 1,
          maxConcurrency: 1,
        },
      },
      './vitest.mutation.browser.config.ts',
    ],
  },
});
