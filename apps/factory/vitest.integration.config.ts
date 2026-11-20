import { defineBaseConfig } from '@wallpaperdb/vitest-config';
import { configuration } from './vitest.config.ts';

export default defineBaseConfig({
  ...configuration,
  test: {
    ...configuration.test,
    name: 'factory-integration',
    include: ['test/**/*.integration.test.ts'],
    // Git and protocol children share the hosted runner's CPU with V8 collection.
    maxWorkers: process.env.CI ? 1 : configuration.test.maxWorkers,
  },
});
