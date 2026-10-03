export type Theme = 'dark' | 'light' | 'system';

export function parseTheme(value: unknown, fallback: Theme = 'system'): Theme {
  return value === 'dark' || value === 'light' || value === 'system' ? value : fallback;
}

export function resolvedTheme(theme: Theme, prefersDark: boolean): 'light' | 'dark' {
  return theme === 'system' ? (prefersDark ? 'dark' : 'light') : theme;
}
