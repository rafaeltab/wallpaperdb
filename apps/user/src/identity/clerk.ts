import type { ExternalIdentity } from '../domain/profile.js';
import type { IdentityProvider } from './identity-provider.js';

export class IdentityProviderUnavailableError extends Error {
  constructor() {
    super('The identity provider is unavailable');
    this.name = 'IdentityProviderUnavailableError';
  }
}

interface ClerkUser {
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
}

export class ClerkIdentityProvider implements IdentityProvider {
  constructor(
    private readonly secretKey: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async getIdentity(profileId: string): Promise<ExternalIdentity> {
    try {
      const response = await this.fetchImpl(
        `https://api.clerk.com/v1/users/${encodeURIComponent(profileId)}`,
        { headers: { Authorization: `Bearer ${this.secretKey}` } }
      );
      if (!response.ok) throw new IdentityProviderUnavailableError();
      const user = (await response.json()) as ClerkUser;
      return { displayName: user.username, firstName: user.first_name, lastName: user.last_name };
    } catch (error) {
      if (error instanceof IdentityProviderUnavailableError) throw error;
      throw new IdentityProviderUnavailableError();
    }
  }
}
