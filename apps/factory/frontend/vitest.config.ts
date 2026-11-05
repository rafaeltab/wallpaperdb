import { fileURLToPath } from 'node:url';
import { defineBaseConfig } from '@wallpaperdb/vitest-config';
export default defineBaseConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    name: 'factory-frontend',
    projects: [
      {
        extends: true,
        test: {
          name: 'factory-frontend-node',
          environment: 'node',
          include: ['frontend/test/**/*.unit.test.ts', 'frontend/test/**/*.unit.test.tsx'],
        },
      },
      {
        extends: true,
        test: {
          name: 'factory-frontend-dom',
          environment: 'jsdom',
          include: ['frontend/test/**/*.dom.test.tsx'],
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: [
        ['lcov', { projectRoot: fileURLToPath(new URL('../../../', import.meta.url)) }],
        'json',
        'json-summary',
      ],
      include: ['frontend/src/**/*.{ts,tsx}'],
      reportsDirectory: './coverage/unit/frontend',
    },
  },
});
