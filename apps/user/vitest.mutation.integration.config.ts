import { defineConfig } from 'vitest/config';
import base from './vitest.integration.config.ts';

// Operation contract only. Database lifetime/cancellation suites remain isolated.
export default defineConfig(async (environment) => {
  const integration = typeof base === 'function' ? await base(environment) : await base;
  return {
    ...integration,
    test: {
      ...integration.test,
      name: 'user-mutation-postgres',
      include: ['test/profile-store.integration.test.ts'],
      setupFiles: ['./test/mutation-postgres-setup.ts'],
      retry: 0,
      maxWorkers: 1,
      maxConcurrency: 1,
    },
  };
});
