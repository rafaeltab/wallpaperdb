import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defaults } from '@wallpaperdb/vitest-config/defaults';
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';

// Tests run in Node by default; .dom.test.ts(x) opts into browser setup.
const domTests = ['test/**/*.dom.test.ts', 'test/**/*.dom.test.tsx'];

export default mergeConfig(
  defaults,
  defineConfig({
    // Unit coverage must also work in a fresh checkout without a dev-server run.
    plugins: [TanStackRouterVite(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    test: {
      name: 'web',
      globals: true,
      testTimeout: 10000,
      hookTimeout: 10000,
      projects: [
        {
          extends: true,
          test: {
            name: 'web-node',
            environment: 'node',
            include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
            exclude: [...configDefaults.exclude, ...domTests],
          },
        },
        {
          extends: true,
          test: {
            name: 'web-dom',
            environment: 'jsdom',
            include: domTests,
            setupFiles: ['./test/setup.ts'],
          },
        },
      ],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts', 'src/**/*.tsx'],
        exclude: [
          'src/**/*.test.ts',
          'src/**/*.test.tsx',
          'src/**/*.d.ts',
          'test/**/*.ts',
          'src/routeTree.gen.ts',
        ],
        reportsDirectory: './coverage/unit',
      },
    },
  })
);
