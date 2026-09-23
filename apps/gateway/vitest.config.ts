import { createRequire } from 'node:module';
import { defaults } from '@wallpaperdb/vitest-config/defaults';
import { defineConfig, mergeConfig } from 'vitest/config';
import baseline from './coverage-baseline.json';

const require = createRequire(import.meta.url);
const searchTests = ['test/{opensearch,profile,profile-search,integration,server}.test.ts'];
const instrumentationTests = ['test/unit/otel.test.ts'];

export default mergeConfig(
  defaults,
  defineConfig({
    resolve: {
      // Mercurius loads GraphQL through CJS; use one class identity in tests.
      alias: { graphql: require.resolve('graphql') },
    },
    test: {
      name: 'gateway',
      environment: 'node',
      testTimeout: 60000,
      hookTimeout: 120000,
      pool: 'threads',
      fileParallelism: true,
      maxWorkers: 2,
      // Fixtures own mutable state; reuse loaded modules within each worker.
      isolate: false,
      projects: [
        {
          extends: true,
          test: {
            name: 'gateway',
            include: ['test/**/*.test.ts'],
            exclude: [...searchTests, ...instrumentationTests],
          },
        },
        {
          extends: true,
          test: {
            name: 'gateway-search',
            include: searchTests,
            globalSetup: ['./test/search-global-setup.ts'],
          },
        },
        {
          extends: true,
          test: {
            name: 'gateway-instrumentation',
            include: instrumentationTests,
            // SDK shutdown closes exporters but leaves process-wide module patches installed.
            pool: 'forks',
            isolate: true,
          },
        },
      ],
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
        reportsDirectory: './coverage/integration',
        thresholds: {
          statements: baseline.statements.pct,
          branches: baseline.branches.pct,
          functions: baseline.functions.pct,
          lines: baseline.lines.pct,
        },
      },
    },
  })
);
