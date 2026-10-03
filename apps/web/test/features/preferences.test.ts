import { expect, it } from 'vitest';
import { parseTheme, resolvedTheme } from '@/features/preferences';
it('accepts saved theme choices and falls back for missing or invalid values', () => {
  expect(parseTheme('dark')).toBe('dark');
  expect(parseTheme('system')).toBe('system');
  expect(parseTheme(null)).toBe('system');
  expect(parseTheme('invalid', 'light')).toBe('light');
});
it('resolves only the system choice using the current device preference', () => {
  expect(resolvedTheme('system', true)).toBe('dark');
  expect(resolvedTheme('system', false)).toBe('light');
  expect(resolvedTheme('light', true)).toBe('light');
  expect(resolvedTheme('dark', false)).toBe('dark');
});
