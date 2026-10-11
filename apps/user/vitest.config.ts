import { defineBaseConfig } from '@wallpaperdb/vitest-config';

const fastTests = [
  'test/{config,cors,health,http,http-lifecycle,maintenance,picture-http,picture-imports,pictures,profile-capability,workers}.test.ts',
];

export default defineBaseConfig({
  test: {
    name: 'user',
    globals: true,
    environment: 'node',
    projects: [
      {
        extends: true,
        test: { name: 'user-unit', include: fastTests },
      },
      {
        extends: true,
        test: {
          name: 'user-integration',
          include: ['test/**/*.test.ts'],
          exclude: fastTests,
        },
      },
    ],
    testTimeout: 60000,
    hookTimeout: 60000,
    maxConcurrency: 5,
    maxWorkers: 5,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
      reportsDirectory: './coverage/integration',
    },
  },
});
