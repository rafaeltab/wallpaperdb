import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
const environment = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://127.0.0.1/ingestor',
  NATS_URL: 'nats://127.0.0.1:4222',
  S3_ENDPOINT: 'http://127.0.0.1:8333',
  S3_ACCESS_KEY_ID: 'access',
  S3_SECRET_ACCESS_KEY: 'private-storage-secret',
};
describe('ingestor configuration', () => {
  it('resolves configuration from the supplied environment with safe defaults', () => {
    expect(loadConfig({ ...environment, PORT: '7139' })).toMatchObject({ port: 7139, rateLimitMax: 100, s3CleanupIntervalMs: 86400000 });
    expect(JSON.stringify(loadConfig(environment))).not.toContain('private-storage-secret');
  });
});

it.each(['PORT', 'REDIS_PORT', 'RATE_LIMIT_MAX', 'RATE_LIMIT_WINDOW_MS', 'RECONCILIATION_INTERVAL_MS', 'S3_CLEANUP_INTERVAL_MS'])('rejects invalid %s before startup', (key) => {
  expect(() => loadConfig({ ...environment, [key]: '0' })).toThrow();
  expect(() => loadConfig({ ...environment, [key]: '3junk' })).toThrow();
});
it('rejects invalid booleans and missing required values without echoing secrets', () => {
  expect(() => loadConfig({ ...environment, REDIS_ENABLED: 'perhaps' })).toThrow();
  expect(() => loadConfig({ ...environment, S3_ENDPOINT: 'private-invalid-url' })).toThrow();
  try { loadConfig({ ...environment, S3_ENDPOINT: 'private-invalid-url' }); } catch (error) {
    expect(String(error)).not.toContain('private-invalid-url');
  }
});
