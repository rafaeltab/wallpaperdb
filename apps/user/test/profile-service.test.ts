import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import type { Profile } from '../src/db/schema.js';
import type { IdentityProvider } from '../src/identity/identity-provider.js';
import {
  HandleAlreadyClaimedError,
  type ProfileRepository,
} from '../src/repositories/profile.repository.js';
import {
  HandleAllocationExhaustedError,
  ProfileService,
  type ProfileServiceDependencies,
} from '../src/services/profile.service.js';

const profile: Profile = {
  id: 'user_123',
  handle: 'ada-lovelace',
  displayName: 'Ada Lovelace',
  biographyMarkdown: '',
  pictureAssetId: null,
  version: 1,
  createdAt: new Date('2026-07-12T12:00:00.000Z'),
  updatedAt: new Date('2026-07-12T12:00:00.000Z'),
};

const config = {
  profileHandleMinLength: 1,
  profileHandleMaxLength: 30,
  profileHandleAllocationAttempts: 2,
  profileReservedHandles: ['admin'],
} as Config;

const dependencies: ProfileServiceDependencies = {
  fallbackName: () => 'Quiet Heron',
  suffix: vi.fn().mockReturnValueOnce('abc').mockReturnValue('def'),
  now: () => new Date('2026-07-12T12:00:00.000Z'),
  eventId: () => 'pevt_123',
};

function setup(existing?: Profile) {
  const repository = {
    findById: vi.fn().mockResolvedValue(existing),
    create: vi.fn().mockResolvedValue(profile),
  } as unknown as ProfileRepository;
  const identityProvider: IdentityProvider = {
    getIdentity: vi.fn().mockResolvedValue({ firstName: 'Ada', lastName: 'Lovelace' }),
  };
  const service = new ProfileService(repository, identityProvider, config, dependencies);
  return { service, repository, identityProvider };
}

describe('ProfileService', () => {
  it('returns existing authoritative state without calling Clerk or writing', async () => {
    const { service, repository, identityProvider } = setup(profile);

    await expect(service.ensure(profile.id)).resolves.toBe(profile);
    expect(identityProvider.getIdentity).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('does not write when Clerk lookup fails', async () => {
    const { service, repository, identityProvider } = setup();
    vi.mocked(identityProvider.getIdentity).mockRejectedValue(new Error('unavailable'));

    await expect(service.ensure(profile.id)).rejects.toThrow('unavailable');
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('retries bounded Handle conflicts with deterministic creation metadata', async () => {
    const { service, repository } = setup();
    vi.mocked(repository.create)
      .mockRejectedValueOnce(new HandleAlreadyClaimedError())
      .mockResolvedValueOnce({ ...profile, handle: 'ada-lovelace-abc' });

    await expect(service.ensure(profile.id)).resolves.toMatchObject({ handle: 'ada-lovelace-abc' });
    expect(repository.create).toHaveBeenNthCalledWith(2, {
      profileId: profile.id,
      displayName: 'Ada Lovelace',
      handle: 'ada-lovelace-abc',
      eventId: 'pevt_123',
      occurredAt: new Date('2026-07-12T12:00:00.000Z'),
    });
  });

  it('bounds collision retries', async () => {
    const { service, repository } = setup();
    vi.mocked(repository.create).mockRejectedValue(new HandleAlreadyClaimedError());

    await expect(service.ensure(profile.id)).rejects.toBeInstanceOf(HandleAllocationExhaustedError);
    expect(repository.create).toHaveBeenCalledTimes(3);
  });

  it('uses a curated Handle fallback when a Unicode Display name has no ASCII slug', async () => {
    const { service, repository, identityProvider } = setup();
    vi.mocked(identityProvider.getIdentity).mockResolvedValue({ displayName: '李小龍' });

    await service.ensure(profile.id);
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      displayName: '李小龍',
      handle: 'quiet-heron',
    }));
  });
});
