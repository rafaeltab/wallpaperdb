import { Effect } from 'effect';
import { createHttpApp } from '../src/http/index.js';
import { services } from './http-fixture.js';
import { describe, expect, it } from 'vitest';

describe('User service CORS', () => {
  it('does not grant credentialed access to a hostname containing a local origin', async () => {
    const app = await createHttpApp(
      { nodeEnv: 'development', port: 3009, clerkSecretKey: 'sk_test_ZXhhbXBsZQ==' },
      services(() => Effect.die('Must not run'))
    );
    const response = await app.inject({
      method: 'OPTIONS',
      url: '/profile/me',
      headers: {
        origin: 'https://localhost:123.evil.example',
        'access-control-request-method': 'PATCH',
      },
    });
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    await app.close();
  });
  it('allows development browser clients to preflight Profile updates', async () => {
    const app = await createHttpApp(
      { nodeEnv: 'development', port: 3009, clerkSecretKey: 'sk_test_ZXhhbXBsZQ==' },
      services(() => Effect.die('Must not run'))
    );

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
