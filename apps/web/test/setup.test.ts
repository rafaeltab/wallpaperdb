import { expect, it } from 'vitest';

it('matches rejected error messages', async () => {
  await expect(Promise.reject(new Error('Network error'))).rejects.toThrow('Network error');
});
