import { defineBaseConfig } from '@wallpaperdb/vitest-config';

const fastTests = [
  'test/{availability,delivery,event-envelope-conformance,events-translation,http,http-operations}.test.ts',
];

export default defineBaseConfig({
  test: {
    name: 'media',
    globals: true,
    environment: 'node',
    projects: [
      {
        extends: true,
        test: { name: 'media-unit', include: fastTests },
      },
      {
        extends: true,
        test: {
          name: 'media-integration',
          include: ['test/**/*.test.ts'],
          exclude: fastTests,
        },
      },
    ],
    testTimeout: 60000, // 60 seconds for testcontainers
    hookTimeout: 60000,
    // Enable parallel test execution within files
    maxConcurrency: 5, // Run up to 5 tests in parallel per file
    maxWorkers: 5,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      reportsDirectory: './coverage/integration',
    },
  },
});
