import { defineBaseConfig } from '@wallpaperdb/vitest-config';
import { configuration } from './vitest.config.ts';

// Operation contract only. Database lifetime/cancellation suites remain isolated.
export default defineBaseConfig({
  ...configuration,
  test: {
    ...configuration.test,
    name: 'user-mutation-postgres',
    include: ['test/profile-store.integration.test.ts'],
    setupFiles: ['./test/mutation-postgres-setup.ts'],
    retry: 0,
    maxWorkers: 1,
    maxConcurrency: 1,
  },
});
