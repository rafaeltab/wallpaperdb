import { createServer } from 'node:http';
import { once } from 'node:events';
import { ManagedRuntime } from 'effect';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { expect, it } from 'vitest';
import { AuthorAuthentication, clerkAuthorLayer } from '../src/adapters/authors/index.js';

it('verifies the configured session profile with real signatures and remote keys before mapping its Owner namespace', async () => {
  const key = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(key.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ keys: [jwk] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing address');
  const provider = {
    adapter: 'clerk' as const,
    issuer: 'https://selected.clerk.accounts.dev',
    ownerNamespace: 'configured-namespace',
    jwksUrl: `http://127.0.0.1:${address.port}/keys`,
    tokenProfile: 'session' as const,
    audience: ['asset-author'],
    authorizedParties: ['https://web.example'],
    requireAuthorizedParty: true,
  };
  const runtime = ManagedRuntime.make(clerkAuthorLayer([provider]));
  const token = (claims: Record<string, unknown> = {}) =>
    new SignJWT({ azp: 'https://web.example', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(provider.issuer)
      .setSubject('user_selected_profile')
      .setAudience('asset-author')
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(key.privateKey);
  try {
    const verify = (token: string) =>
      runtime.runPromise(AuthorAuthentication.use((service) => service.verify(`Bearer ${token}`)));
    expect(await verify(await token())).toEqual({
      namespace: 'configured-namespace',
      subject: 'user_selected_profile',
    });
    expect(await verify(await token({ azp: 'https://other.example' }))).toBeNull();
    expect(await verify(await token({ azp: undefined }))).toBeNull();
    const expired = await new SignJWT({ azp: 'https://web.example' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(provider.issuer)
      .setSubject('user_selected_profile')
      .setAudience('asset-author')
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(key.privateKey);
    expect(await verify(expired)).toBeNull();
    const wrongAudience = await new SignJWT({ azp: 'https://web.example' })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(provider.issuer)
      .setSubject('user_selected_profile')
      .setAudience('other')
      .setIssuedAt()
      .setExpirationTime('2m')
      .sign(key.privateKey);
    expect(await verify(wrongAudience)).toBeNull();
    expect(await verify('malformed-token')).toBeNull();
    expect(
      await runtime.runPromise(AuthorAuthentication.use((service) => service.verify(undefined)))
    ).toBeNull();
  } finally {
    await runtime.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
