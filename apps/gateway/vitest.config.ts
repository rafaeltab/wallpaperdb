import { createRequire } from 'node:module';
import { defineBaseConfig } from '@wallpaperdb/vitest-config';
import baseline from './coverage-baseline.json';

const require = createRequire(import.meta.url);

export default defineBaseConfig({
  resolve: {
    // Mercurius loads GraphQL through CJS; use one class identity in tests.
    alias: { graphql: require.resolve('graphql') },
  },
  test: {
    name: 'gateway',
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 60000,
    hookTimeout: 120000,
    fileParallelism: false,
    isolate: true,
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
});
