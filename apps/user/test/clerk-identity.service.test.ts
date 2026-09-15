import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import { ClerkIdentityProvider } from '../src/services/clerk-identity.service.js';

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }));

vi.mock('@clerk/backend', () => ({
  createClerkClient: () => ({ users: { getUser } }),
}));

describe('ClerkIdentityProvider', () => {
  beforeEach(() => getUser.mockReset());

  it.each([true, false])('captures only custom Clerk pictures when hasImage is %s', async (hasImage) => {
    const imageUrl = 'https://img.clerk.com/initial-picture';
    getUser.mockResolvedValue({ firstName: null, lastName: null, imageUrl, hasImage });
    const provider = new ClerkIdentityProvider({ clerkSecretKey: 'secret' } as Config);
    expect((await provider.getIdentity('user_123')).imageUrl).toBe(hasImage ? imageUrl : null);
  });

  it('does not treat a Clerk username as a Profile Display name', async () => {
    getUser.mockResolvedValue({ username: 'ada123', firstName: 'Ada', lastName: 'Lovelace' });
    const provider = new ClerkIdentityProvider({ clerkSecretKey: 'secret' } as Config);

    await expect(provider.getIdentity('user_123')).resolves.toEqual({
      displayName: null,
      firstName: 'Ada',
      lastName: 'Lovelace',
      imageUrl: null,
    });
  });
});
