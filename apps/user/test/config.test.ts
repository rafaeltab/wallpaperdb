import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const originalEnv = { ...process.env };

describe('User service configuration', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgres://localhost/wallpaperdb_user';
    process.env.NATS_URL = 'nats://localhost:4222';
    process.env.PROFILE_HANDLE_MIN_LENGTH = '1';
    delete process.env.CLERK_SECRET_KEY;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('accepts a short configured Handle maximum', () => {
    process.env.PROFILE_HANDLE_MAX_LENGTH = '3';

    expect(loadConfig().profileHandleMaxLength).toBe(3);
  });

  it('rejects a Handle minimum above the configured maximum', () => {
    process.env.PROFILE_HANDLE_MIN_LENGTH = '4';
    process.env.PROFILE_HANDLE_MAX_LENGTH = '3';

    expect(() => loadConfig()).toThrow('Profile Handle minimum length must not exceed its maximum');
  });

  it('requires a Clerk secret outside tests', () => {
    process.env.NODE_ENV = 'production';
    process.env.PROFILE_HANDLE_MAX_LENGTH = '30';

    expect(() => loadConfig()).toThrow('CLERK_SECRET_KEY is required outside tests');
  });
});
