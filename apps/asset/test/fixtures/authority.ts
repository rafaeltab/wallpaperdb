export const authorityFixture = () => ({
  revision: 'test-1',
  broker: {
    maxAckPending: 32,
    streams: {
      ASSET_COMMANDS: { maxBytes: 1048576, maxMessages: 10000 },
      ASSET_RESULTS: { maxBytes: 1048576, maxMessages: 10000 },
      ASSET_QUARANTINE: { maxBytes: 1048576, maxMessages: 10000 },
      ASSET_OPERATIONS: { maxBytes: 1048576, maxMessages: 10000 },
    },
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
