import { IAuthServiceToken, type IAuthService } from '@wallpaperdb/auth';
import Fastify from 'fastify';
import { container } from 'tsyringe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IdentityProviderUnavailableError } from '../src/identity/clerk.js';
import profileRoutes from '../src/routes/profile.routes.js';
import { ProfileService } from '../src/services/profile.service.js';

describe('POST /profile/me/ensure', () => {
  afterEach(() => container.clearInstances());

  it('derives the Profile ID from auth and returns public authoritative state', async () => {
    const getUser = vi.fn().mockReturnValue({ id: 'user_from_jwt' });
    const ensure = vi.fn().mockResolvedValue({
      id: 'user_from_jwt',
      handle: 'ada',
      displayName: 'Ada',
      biographyMarkdown: '',
      pictureAssetId: null,
      version: 1,
      createdAt: new Date('2026-07-12T12:00:00.000Z'),
      updatedAt: new Date('2026-07-12T12:00:00.000Z'),
    });
    container.register(IAuthServiceToken, { useValue: { getUser } as unknown as IAuthService });
    container.register(ProfileService, { useValue: { ensure } as unknown as ProfileService });
    const app = Fastify();
    await app.register(profileRoutes);

    const response = await app.inject({ method: 'POST', url: '/profile/me/ensure' });

    expect(response.statusCode).toBe(200);
    expect(ensure).toHaveBeenCalledWith('user_from_jwt');
    expect(response.json()).toMatchObject({ id: 'user_from_jwt', pictureAssetId: null });
    await app.close();
  });

  it('maps Clerk lookup failures to problem details', async () => {
    container.register(IAuthServiceToken, {
      useValue: { getUser: () => ({ id: 'user_123' }) } as unknown as IAuthService,
    });
    container.register(ProfileService, {
      useValue: {
        ensure: vi.fn().mockRejectedValue(new IdentityProviderUnavailableError()),
      } as unknown as ProfileService,
    });
    const app = Fastify();
    await app.register(profileRoutes);

    const response = await app.inject({ method: 'POST', url: '/profile/me/ensure' });

    expect(response.statusCode).toBe(503);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json()).toMatchObject({ status: 503 });
    await app.close();
  });
});
