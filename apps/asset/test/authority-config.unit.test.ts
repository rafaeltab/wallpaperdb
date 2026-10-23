import { describe, expect, it } from 'vitest';
import { parseAuthority } from '../src/authority.js';
import { authorityFixture } from './fixtures/authority.js';
describe('trusted Asset authority file', () => {
  it('computes order-independent non-secret configuration identity and rejects unsafe routing', () => {
    const raw = authorityFixture();
    const parsed = parseAuthority(raw);
    expect(
      parseAuthority({
        ...raw,
        operatorNotification: { ...raw.operatorNotification, token: 'another-token' },
      }).identity
    ).toBe(parsed.identity);
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
