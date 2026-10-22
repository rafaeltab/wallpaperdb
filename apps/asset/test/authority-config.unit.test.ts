import { describe, expect, it } from 'vitest';
import { parseAuthority } from '../src/authority.js';
export const authorityFixture = () => ({
  revision: 'test-1',
  broker: {
    service: { user: 'asset-service', password: 'service-secret', revision: '1' },
    operator: { user: 'asset-operator', password: 'operator-secret', revision: '1' },
  },
  applications: {
    wallpaper: {
      ownerNamespace: 'clerk-test',
      allowedOperations: ['create'],
      allowedTypes: ['wallpaper'],
      credentials: [{ user: 'wallpaper-1', password: 'wallpaper-secret', revision: '1' }],
    },
    user: {
      ownerNamespace: 'clerk-test',
      allowedOperations: ['create'],
      allowedTypes: ['picture'],
      credentials: [{ user: 'user-1', password: 'user-secret', revision: '1' }],
    },
  },
  identityProviders: {
    clerk: {
      adapter: 'clerk',
      ownerNamespace: 'clerk-test',
      issuer: 'https://example.clerk.accounts.dev',
      jwksUrl: 'https://example.clerk.accounts.dev/.well-known/jwks.json',
      tokenProfile: 'session',
      authorizedParties: ['http://localhost:8000'],
      audience: [],
    },
  },
  assetTypes: { wallpaper: {}, picture: {} },
  delivery: { maxAttempts: 3, retryDelayMs: 100, pollMs: 20, shutdownTimeoutMs: 1000 },
});
describe('trusted Asset authority file', () => {
  it('computes order-independent non-secret configuration identity and rejects unsafe routing', () => {
    const raw = authorityFixture();
    const parsed = parseAuthority(raw);
    expect(parsed.applications.wallpaper?.createSubject).toBe('asset.commands.wallpaper.create');
    expect(parsed.applications.user?.resultSubject).toBe('asset.results.user');
    expect(parseAuthority({ ...raw, assetTypes: { picture: {}, wallpaper: {} } }).identity).toBe(
      parsed.identity
    );
    expect(
      parseAuthority({
        ...raw,
        broker: { ...raw.broker, service: { ...raw.broker.service, password: 'rotated-secret' } },
      }).identity
    ).toBe(parsed.identity);
    expect(parseAuthority({ ...raw, revision: 'test-2' }).identity).not.toBe(parsed.identity);
    expect(() =>
      parseAuthority({ ...raw, applications: { 'bad.*': raw.applications.user } })
    ).toThrow();
    expect(() =>
      parseAuthority({
        ...raw,
        applications: { user: { ...raw.applications.user, allowedTypes: ['missing'] } },
      })
    ).toThrow();
    expect(() =>
      parseAuthority({
        ...raw,
        applications: { user: { ...raw.applications.user, ownerNamespace: 'unverified' } },
      })
    ).toThrow();
    expect(() =>
      parseAuthority({
        ...raw,
        identityProviders: {
          clerk: { ...raw.identityProviders.clerk, jwksUrl: 'http://attacker.test/keys' },
        },
      })
    ).toThrow();
  });
});
