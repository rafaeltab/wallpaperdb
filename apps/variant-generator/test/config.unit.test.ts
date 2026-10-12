import { afterEach, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
afterEach(() => vi.unstubAllEnvs());
function required() {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('S3_ENDPOINT', 'http://127.0.0.1:9000');
  vi.stubEnv('S3_ACCESS_KEY_ID', 'test-access');
  vi.stubEnv('S3_SECRET_ACCESS_KEY', 'test-secret');
  vi.stubEnv('NATS_URL', 'nats://127.0.0.1:4222');
}
it('parses infrastructure configuration once with existing defaults', () => {
  required();
  for (const name of [
    'PORT',
    'S3_BUCKET',
    'S3_REGION',
    'NATS_STREAM',
    'OTEL_SERVICE_NAME',
    'OTEL_EXPORTER_OTLP_ENDPOINT',
  ])
    vi.stubEnv(name, undefined);
  expect(loadConfig()).toMatchObject({
    port: 3006,
    nodeEnv: 'test',
    s3Bucket: 'wallpapers',
    s3Region: 'us-east-1',
    natsStream: 'WALLPAPER',
    otelServiceName: 'variant-generator',
  });
});
it('rejects invalid startup configuration', () => {
  required();
  vi.stubEnv('NODE_ENV', 'invalid');
  expect(() => loadConfig()).toThrow();
});
