import { describe, expect, it } from 'vitest';
import { positiveIntegerEnv } from '@/lib/runtime-config';

describe('positiveIntegerEnv', () => {
  it.each([undefined, '', 'not-a-number', '0', '-1', '1.5'])(
    'uses the fallback for invalid value %s',
    (value) => {
      expect(positiveIntegerEnv(value, 80)).toBe(80);
    }
  );

  it('accepts a configured positive integer', () => {
    expect(positiveIntegerEnv('120', 80)).toBe(120);
  });
});
