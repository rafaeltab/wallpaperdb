import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('Ingestor S3 cleanup configuration', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/wallpaperdb_ingestor');
    vi.stubEnv('NATS_URL', 'nats://localhost:4222');
    vi.stubEnv('S3_ENDPOINT', 'http://localhost:9000');
    vi.stubEnv('S3_ACCESS_KEY_ID', 'storageadmin');
    vi.stubEnv('S3_SECRET_ACCESS_KEY', 'storageadmin');
    vi.stubEnv('S3_CLEANUP_INTERVAL_MS', undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('loads the S3 cleanup interval from the environment', () => {
    vi.stubEnv('S3_CLEANUP_INTERVAL_MS', '2000');

    expect(loadConfig().s3CleanupIntervalMs).toBe(2000);
  });

  it('defaults to one day when the S3 cleanup interval is absent', () => {
    expect(loadConfig().s3CleanupIntervalMs).toBe(24 * 60 * 60 * 1000);
  });

  it('rejects a non-positive S3 cleanup interval', () => {
    vi.stubEnv('S3_CLEANUP_INTERVAL_MS', '0');

    expect(() => loadConfig()).toThrow();
  });
});
