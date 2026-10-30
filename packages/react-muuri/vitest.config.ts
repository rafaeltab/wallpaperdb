import react from '@vitejs/plugin-react';
import { playwright } from '@vitest/browser-playwright';
import { defaults } from '@wallpaperdb/vitest-config/defaults';
import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import type { BrowserProviderOption } from 'vitest/node';

export default mergeConfig(
  defaults,
  defineConfig({
    plugins: [react()],
    test: {
      name: 'react-muuri',
      globals: true,
      environment: 'jsdom',
      setupFiles: ['./test/setup.ts'],
      testTimeout: 10000,
      hookTimeout: 10000,
      projects: [
        {
          extends: true,
          test: {
            name: 'react-muuri-unit',
            include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
            exclude: [...configDefaults.exclude, 'test/hooks/useGrid.test.tsx'],
          },
        },
        {
          extends: true,
          test: {
            name: 'react-muuri-browser',
            include: ['test/hooks/useGrid.test.tsx'],
            browser: {
              enabled: true,
              headless: true,
              // Vitest and its provider are both pinned to 5.0.2. Their pnpm peer
              // variants give the same private server types separate identities.
              provider: playwright() as unknown as BrowserProviderOption,
              instances: [{ browser: 'chromium' }],
            },
          },
        },
      ],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts', 'src/**/*.tsx'],
        exclude: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.d.ts', 'test/**/*.ts'],
        reportsDirectory: './coverage/unit',
      },
    },
  })
);
