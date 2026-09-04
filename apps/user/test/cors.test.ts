import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerUserCors } from '../src/http/cors.js';

describe('User service CORS', () => {
  it('allows development browser clients to preflight Profile updates', async () => {
    const app = Fastify();
    await registerUserCors(app, 'development');

    const response = await app.inject({
      method: 'OPTIONS',
      url: '/profile/me',
      headers: {
        origin: 'http://localhost:5173',
        'access-control-request-method': 'PATCH',
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers['access-control-allow-methods']).toContain('PATCH');
    await app.close();
  });
});
