import { beforeAll, expect } from 'vitest';

beforeAll(() => {
  const state = expect.getState();
  // Only this suite uses source-mapped native bundles. Keep other suites' existing
  // coverage collection without collecting their tsx subprocess offsets as native TS.
  if (!state.testPath?.endsWith('/source-storage.integration.test.ts')) {
    delete process.env.NODE_V8_COVERAGE;
  }
});
