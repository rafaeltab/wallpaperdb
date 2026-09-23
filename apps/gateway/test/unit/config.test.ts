import { describe, expect, it } from 'vitest';
import { ConfigProvider, Effect } from 'effect';
import { gatewayConfig, loadConfig } from '../../src/config.js';
const environment = {
  OPENSEARCH_URL: 'http://127.0.0.1:9200',
  NATS_URL: 'nats://127.0.0.1:4222',
  MEDIA_SERVICE_URL: 'http://127.0.0.1:3003',
  CURSOR_SECRET: 'test-secret-000000000000000000000000',
  REDIS_ENABLED: 'false',
};
describe('startup configuration', () => {
  it('identifies invalid configuration fields without retaining supplied secrets', async () => {
    const secret = 'private';
    const error = await Effect.runPromise(
      gatewayConfig.pipe(
        Effect.provideService(
          ConfigProvider.ConfigProvider,
          ConfigProvider.fromUnknown({ ...environment, CURSOR_SECRET: secret })
        ),
        Effect.flip
      )
    );
    expect(error.fields).toContain('CURSOR_SECRET');
    expect(JSON.stringify(error)).not.toContain(secret);
  });
  it('reports provider failures without retaining connection details', async () => {
    const provider = ConfigProvider.make(() =>
      Effect.fail(new ConfigProvider.SourceError({ message: 'private connection details' }))
    );
    const error = await Effect.runPromise(
      gatewayConfig.pipe(
        Effect.provideService(ConfigProvider.ConfigProvider, provider),
        Effect.flip
      )
    );
    expect(error).toMatchObject({ _tag: 'GatewayConfigurationError', fields: [] });
    expect(JSON.stringify(error)).not.toContain('private connection details');
  });
  it('parses defaults once without reading ambient configuration', () => {
    expect(loadConfig(environment)).toMatchObject({
      port: 3004,
      opensearchProfileIndex: undefined,
      colorSpreadStrategy: 'linear',
      redisEnabled: false,
      graphqlIntrospectionEnabled: true,
      graphqlMaxComplexity: 2000,
      cursorExpirationMs: 604800000,
    });
  });
  it('redacts successfully loaded credentials when configuration is inspected', () => {
    const config = loadConfig({
      ...environment,
      OPENSEARCH_PASSWORD: 'search-private',
      REDIS_PASSWORD: 'quota-private',
    });
    const serialized = JSON.stringify(config);
    expect(serialized).not.toContain('search-private');
    expect(serialized).not.toContain('quota-private');
    expect(serialized).not.toContain(environment.CURSOR_SECRET);
  });
  it('parses explicit values and production introspection defaults', () => {
    expect(
      loadConfig({
        ...environment,
        NODE_ENV: 'production',
        PORT: '7000',
        OPENSEARCH_PROFILE_INDEX: 'custom_profiles',
        COLOR_SPREAD_STRATEGY: 'exact',
        RATE_LIMIT_ENABLED: 'false',
        GRAPHQL_INTROSPECTION_ENABLED: 'true',
        GRAPHQL_MAX_COMPLEXITY: '1505',
        REDIS_ENABLED: 'true',
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: '6379',
        MEDIA_PUBLIC_BASE_URL: 'https://cdn.example.com',
      })
    ).toMatchObject({
      port: 7000,
      opensearchProfileIndex: 'custom_profiles',
      colorSpreadStrategy: 'exact',
      rateLimitEnabled: false,
      graphqlIntrospectionEnabled: true,
      graphqlMaxComplexity: 1505,
      redisEnabled: true,
    });
    expect(loadConfig({ ...environment, NODE_ENV: 'production' }).graphqlIntrospectionEnabled).toBe(
      false
    );
  });
  it.each([
    { PORT: '10garbage' },
    { OPENSEARCH_PROFILE_INDEX: '' },
    { COLOR_SPREAD_STRATEGY: 'invalid' },
    { CURSOR_SECRET: 'short' },
    { RATE_LIMIT_ENABLED: 'yes' },
    { GRAPHQL_MAX_DEPTH: '0' },
    { MEDIA_PUBLIC_BASE_URL: 'invalid' },
    { PORT: '65536' },
  ])('fails invalid startup configuration without exposing supplied values %j', (invalid) => {
    expect(() => loadConfig({ ...environment, ...invalid })).toThrow(
      'Invalid gateway configuration'
    );
  });
});
