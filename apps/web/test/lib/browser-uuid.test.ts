import { afterEach, expect, it, vi } from 'vitest';

import { browserUuid } from '@/lib/browser-uuid';

afterEach(() => vi.unstubAllGlobals());

it('uses the native UUID with its Crypto receiver when available', () => {
  const native = vi.fn(function (this: unknown) {
    expect(this).toBe(provider);
    return '12345678-1234-4234-8234-123456789abc';
  });
  const randomBytes = vi.fn();
  const provider = { randomUUID: native, getRandomValues: randomBytes };
  vi.stubGlobal('crypto', provider);
  expect(browserUuid()).toBe('12345678-1234-4234-8234-123456789abc');
  expect(native).toHaveBeenCalledOnce();
  expect(randomBytes).not.toHaveBeenCalled();
});

it.each([
  {
    bytes: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    expected: '00010203-0405-4607-8809-0a0b0c0d0e0f',
  },
  {
    bytes: Array(16).fill(255),
    expected: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
  },
])(
  'uses 16 cryptographic bytes and sets UUID v4 version and variant bits: $expected',
  ({ bytes, expected }) => {
    const provider = {
      getRandomValues: vi.fn(function (this: unknown, output: Uint8Array) {
        expect(this).toBe(provider);
        expect(output).toBeInstanceOf(Uint8Array);
        expect(output).toHaveLength(16);
        output.set(bytes);
        return output;
      }),
    };
    vi.stubGlobal('crypto', provider);
    expect(browserUuid()).toBe(expected);
    expect(provider.getRandomValues).toHaveBeenCalledOnce();
  }
);

it('draws fresh bytes for each fallback identifier', () => {
  let draw = 0;
  vi.stubGlobal('crypto', {
    getRandomValues(output: Uint8Array) {
      output.fill(++draw);
      return output;
    },
  });
  expect(browserUuid()).toBe('01010101-0101-4101-8101-010101010101');
  expect(browserUuid()).toBe('02020202-0202-4202-8202-020202020202');
});
