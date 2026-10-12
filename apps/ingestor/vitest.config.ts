import { defaults } from '@wallpaperdb/vitest-config/defaults';
import { defineConfig, mergeConfig } from 'vitest/config';

const instrumentationTests = ['test/instrumentation/**/*.integration.test.ts'];

export default mergeConfig(
  defaults,
  defineConfig({
    test: {
      name: 'ingestor',
      environment: 'node',
      testTimeout: 60000,
      hookTimeout: 60000,
      pool: 'threads',
      maxWorkers: 2,
      projects: [
        {
          extends: true,
          test: { name: 'ingestor-unit', include: ['test/**/*.unit.test.ts'] },
        },
        {
          extends: true,
          test: {
            name: 'ingestor-integration',
            include: ['test/**/*.integration.test.ts'],
            exclude: instrumentationTests,
          },
        },
        {
          extends: true,
          test: {
            name: 'ingestor-instrumentation',
            include: instrumentationTests,
            // OpenTelemetry SDK module patches outlive exporter shutdown.
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
      },
    },
  })
);
