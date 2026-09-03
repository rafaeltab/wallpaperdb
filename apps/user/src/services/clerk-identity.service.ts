import { createClerkClient } from '@clerk/backend';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';

export interface ExternalIdentity {
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface IdentityProvider {
  getIdentity(userId: string): Promise<ExternalIdentity>;
}

export const IdentityProviderToken = 'IdentityProvider' as const;

@singleton()
export class ClerkIdentityProvider implements IdentityProvider {
  private readonly clerk;

  constructor(@inject('config') config: Config) {
    this.clerk = createClerkClient({ secretKey: config.clerkSecretKey });
  }

  async getIdentity(userId: string): Promise<ExternalIdentity> {
    const user = await this.clerk.users.getUser(userId);
    return {
      // Clerk usernames are identifiers, not WallpaperDB Profile Display names.
      displayName: null,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }
}
