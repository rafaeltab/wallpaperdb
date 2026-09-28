import * as matchers from '@testing-library/jest-dom/matchers';
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';
import { expect } from 'vitest';

declare module 'vitest' {
  interface Matchers<R extends void | Promise<void>>
    extends TestingLibraryMatchers<{ asymmetricMatch: (value: unknown) => boolean }, R> {}
}

// Register on this workspace's Vitest instance; the jest-dom entry point can resolve another copy.
expect.extend(matchers);
