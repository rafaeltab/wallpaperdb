import { expect, it } from 'vitest';

it('matches rejected error messages', async () => {
  await expect(Promise.reject(new Error('Network error'))).rejects.toThrow('Network error');
});

it('accepts asymmetric matchers for accessible names', () => {
  const button = document.createElement('button');
  button.setAttribute('aria-label', 'Upload wallpaper');
  expect(button).toHaveAccessibleName({
    asymmetricMatch: (value: unknown) => typeof value === 'string' && value.includes('wallpaper'),
  });
});
