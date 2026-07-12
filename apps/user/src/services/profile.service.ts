import { randomBytes, randomUUID } from 'node:crypto';
import { inject, singleton } from 'tsyringe';
import type { Config } from '../config.js';
import type { Profile } from '../db/schema.js';
import { deriveDisplayName, handleCandidates, slugifyHandle } from '../domain/profile.js';
import { type IdentityProvider, IdentityProviderToken } from '../identity/identity-provider.js';
import {
  HandleAlreadyClaimedError,
  ProfileAlreadyExistsError,
  ProfileRepository,
} from '../repositories/profile.repository.js';

export class HandleAllocationExhaustedError extends Error {}

export interface ProfileServiceDependencies {
  fallbackName: (profileId: string) => string;
  suffix: () => string;
  now: () => Date;
  eventId: () => string;
}

export const ProfileServiceDependenciesToken = Symbol('ProfileServiceDependencies');

@singleton()
export class ProfileService {
  constructor(
    @inject(ProfileRepository) private readonly repository: ProfileRepository,
    @inject(IdentityProviderToken) private readonly identityProvider: IdentityProvider,
    @inject('config') private readonly config: Config,
    @inject(ProfileServiceDependenciesToken)
    private readonly dependencies: ProfileServiceDependencies
  ) {}

  async ensure(profileId: string): Promise<Profile> {
    const existing = await this.repository.findById(profileId);
    if (existing) return existing;

    const identity = await this.identityProvider.getIdentity(profileId);
    const displayName = deriveDisplayName(profileId, identity, this.dependencies.fallbackName);
    let handleSource = displayName;
    try {
      slugifyHandle(
        handleSource,
        this.config.profileHandleMinLength,
        this.config.profileHandleMaxLength
      );
    } catch {
      handleSource = this.dependencies.fallbackName(profileId);
    }
    const candidates = handleCandidates(handleSource, {
      minLength: this.config.profileHandleMinLength,
      maxLength: this.config.profileHandleMaxLength,
      attempts: this.config.profileHandleAllocationAttempts,
      reserved: new Set(this.config.profileReservedHandles),
      nextSuffix: this.dependencies.suffix,
    });

    for (const handle of candidates) {
      try {
        return await this.repository.create({
          profileId,
          displayName,
          handle,
          eventId: this.dependencies.eventId(),
          occurredAt: this.dependencies.now(),
        });
      } catch (error) {
        if (error instanceof ProfileAlreadyExistsError) {
          const concurrentlyCreated = await this.repository.findById(profileId);
          if (concurrentlyCreated) return concurrentlyCreated;
          throw error;
        }
        if (!(error instanceof HandleAlreadyClaimedError)) throw error;
        const concurrentlyCreated = await this.repository.findById(profileId);
        if (concurrentlyCreated) return concurrentlyCreated;
      }
    }
    throw new HandleAllocationExhaustedError('Unable to allocate a unique handle');
  }
}

export const defaultProfileServiceDependencies: ProfileServiceDependencies = {
  fallbackName: (profileId) => deriveDisplayName(profileId, {}),
  suffix: () => randomBytes(3).toString('hex'),
  now: () => new Date(),
  eventId: () => `pevt_${randomUUID()}`,
};
