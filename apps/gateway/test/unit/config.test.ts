import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
const environment = {
  OPENSEARCH_URL: 'http://127.0.0.1:9200',
  NATS_URL: 'nats://127.0.0.1:4222',
  MEDIA_SERVICE_URL: 'http://127.0.0.1:3003',
  CURSOR_SECRET: 'test-secret-000000000000000000000000',
  REDIS_ENABLED: 'false',
};
describe('startup configuration', () => {
  it('parses defaults once without reading ambient configuration', () => {
    expect(loadConfig(environment)).toMatchObject({
      port: 3004,
      colorSpreadStrategy: 'linear',
      redisEnabled: false,
      graphqlIntrospectionEnabled: true,
      cursorExpirationMs: 604800000,
    });
  });
  it('parses explicit values and production introspection defaults', () => {
    expect(
      loadConfig({
        ...environment,
        NODE_ENV: 'production',
        PORT: '7000',
        COLOR_SPREAD_STRATEGY: 'exact',
        RATE_LIMIT_ENABLED: 'false',
        GRAPHQL_INTROSPECTION_ENABLED: 'true',
        REDIS_ENABLED: 'true',
        REDIS_HOST: '127.0.0.1',
        REDIS_PORT: '6379',
        MEDIA_PUBLIC_BASE_URL: 'https://cdn.example.com',
      })
    ).toMatchObject({
      port: 7000,
      colorSpreadStrategy: 'exact',
      rateLimitEnabled: false,
      graphqlIntrospectionEnabled: true,
      redisEnabled: true,
    });
    expect(loadConfig({ ...environment, NODE_ENV: 'production' }).graphqlIntrospectionEnabled).toBe(
      false
    );
  });
  it.each([
    { PORT: '10garbage' },
    { COLOR_SPREAD_STRATEGY: 'invalid' },
    { CURSOR_SECRET: 'short' },
    { RATE_LIMIT_ENABLED: 'yes' },
    { GRAPHQL_MAX_DEPTH: '0' },
  ])('fails invalid startup configuration without exposing supplied values %j', (invalid) => {
    expect(() => loadConfig({ ...environment, ...invalid })).toThrow(
      'Invalid gateway configuration'
    );
  });
});
