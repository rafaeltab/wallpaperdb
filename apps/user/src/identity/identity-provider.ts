import type { ExternalIdentity } from '../domain/profile.js';

export interface IdentityProvider {
  getIdentity(profileId: string): Promise<ExternalIdentity>;
}

export const IdentityProviderToken = 'IdentityProvider' as const;
