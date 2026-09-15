import 'reflect-metadata';
import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerAuth } from '../src/register-auth.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('service credentials with the production Clerk plugin', () => {
  it('allows independent service authentication without authenticating an owner command', async () => {
    const publicKey = `pk_test_${Buffer.from('picture-tests.clerk.accounts.dev$').toString('base64')}`;
    vi.stubEnv('CLERK_PUBLISHABLE_KEY', publicKey);
    const fetcher = vi.fn(() => Promise.reject(new Error('This auth check must not contact Clerk')));
    vi.stubGlobal('fetch', fetcher);
    const app = Fastify({ logger: false });
    const serviceToken = 'a'.repeat(64);
    try {
      await registerAuth(app, { secretKey: 'sk_test_local_service_boundary', testMode: false });
      app.get('/internal/availability', { config: { skipAuth: true } }, (request, reply) => {
        return reply.code(request.headers.authorization === `Bearer ${serviceToken}` ? 204 : 401).send();
      });
      app.get('/profile/me', () => ({ owner: true }));

      const availability = await app.inject({
        method: 'GET', url: '/internal/availability',
        headers: { authorization: `Bearer ${serviceToken}` },
      });
      expect(availability.statusCode).toBe(204);
      expect(availability.headers.location).toBeUndefined();

      const owner = await app.inject({
        method: 'GET', url: '/profile/me',
        headers: { authorization: `Bearer ${serviceToken}` },
      });
      expect(owner.statusCode).toBe(401);
      expect(owner.json().type).toContain('unauthorized');
      const wrongToken = await app.inject({
        method: 'GET', url: '/internal/availability',
        headers: { authorization: `Bearer ${'b'.repeat(64)}` },
      });
      expect(wrongToken.statusCode).toBe(401);
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
