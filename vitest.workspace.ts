import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  'packages/*/vitest.config.ts',  // Package tests
  'apps/*/vitest.config.ts',      // App tests
]);
