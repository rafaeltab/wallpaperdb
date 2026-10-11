import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defaults } from '@wallpaperdb/vitest-config/defaults';
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';

// Opt in only inspected pure tests. New files keep the DOM setup until reviewed.
const nodeTests = [
  'test/features/authentication.test.ts',
  'test/features/browse.test.ts',
  'test/features/color-composition.test.ts',
  'test/features/color-picker.test.ts',
  'test/features/feature-architecture.test.ts',
  'test/features/feed.test.ts',
  'test/features/grid-layout.test.ts',
  'test/features/grid-sizing.test.ts',
  'test/features/preferences.test.ts',
  'test/features/profile-editor.test.ts',
  'test/features/profile-management.test.ts',
  'test/features/public-profile.test.ts',
  'test/features/request-admission.test.ts',
  'test/features/upload-presentation.test.ts',
  'test/features/upload-queue.test.ts',
  'test/features/wallpaper-details.test.ts',
  'test/features/wallpaper-download.test.ts',
];

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
            include: nodeTests,
          },
        },
        {
          extends: true,
          test: {
            name: 'web-dom',
            environment: 'jsdom',
            include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
            exclude: [...configDefaults.exclude, ...nodeTests],
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
