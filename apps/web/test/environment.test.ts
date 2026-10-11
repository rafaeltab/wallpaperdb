import { expect, it, vi } from 'vitest';

it('runs unmarked tests without browser globals or DOM setup', () => {
  for (const name of [
    'window',
    'document',
    'DataTransfer',
    'ResizeObserver',
    'IntersectionObserver',
    'caches',
  ]) {
    expect(name in globalThis, `${name} must not be supplied to Node tests`).toBe(false);
  }

  expect('toHaveAccessibleName' in expect(null)).toBe(false);
  expect(vi.isMockFunction(URL.createObjectURL)).toBe(false);
});
