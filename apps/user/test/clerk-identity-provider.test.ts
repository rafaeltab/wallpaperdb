import { describe, expect, it, vi } from 'vitest';
import { ClerkIdentityProvider, IdentityProviderUnavailableError } from '../src/identity/clerk.js';

describe('ClerkIdentityProvider', () => {
  it('maps Clerk public identity without exposing private fields', async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          username: 'ada-online',
          first_name: 'Ada',
          last_name: 'Lovelace',
          email_addresses: [{ email_address: 'private@example.com' }],
        }),
        { status: 200 }
      )
    );
    const provider = new ClerkIdentityProvider('secret', fetch);

    await expect(provider.getIdentity('user/1')).resolves.toEqual({
      displayName: 'ada-online',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    expect(fetch).toHaveBeenCalledWith('https://api.clerk.com/v1/users/user%2F1', {
      headers: { Authorization: 'Bearer secret' },
    });
  });

  it('converts transport and non-success responses to service unavailability', async () => {
    const rejected = new ClerkIdentityProvider('secret', vi.fn().mockRejectedValue(new Error('down')));
    await expect(rejected.getIdentity('user_1')).rejects.toBeInstanceOf(
      IdentityProviderUnavailableError
    );

    const failed = new ClerkIdentityProvider(
      'secret',
      vi.fn().mockResolvedValue(new Response('nope', { status: 503 }))
    );
    await expect(failed.getIdentity('user_1')).rejects.toBeInstanceOf(
      IdentityProviderUnavailableError
    );
  });
});
