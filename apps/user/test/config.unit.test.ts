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

  it('defaults Profile evidence retention to thirty days and permits a positive configured window', () => {
    delete process.env.PROFILE_EVIDENCE_RETENTION_DAYS;
    expect(loadConfig().profileEvidenceRetentionDays).toBe(30);
    process.env.PROFILE_EVIDENCE_RETENTION_DAYS = '7';
    expect(loadConfig().profileEvidenceRetentionDays).toBe(7);
    process.env.PROFILE_EVIDENCE_RETENTION_DAYS = '0';
    expect(() => loadConfig()).toThrow();
    process.env.PROFILE_EVIDENCE_RETENTION_DAYS = '-1';
    expect(() => loadConfig()).toThrow();
  });

  it('configures the Biography character limit with a default of five thousand', () => {
    delete process.env.PROFILE_BIOGRAPHY_MAX_LENGTH;
    expect(loadConfig().profileBiographyMaxLength).toBe(5000);
    process.env.PROFILE_BIOGRAPHY_MAX_LENGTH = '1200';
    expect(loadConfig().profileBiographyMaxLength).toBe(1200);
    process.env.PROFILE_BIOGRAPHY_MAX_LENGTH = '0';
    expect(() => loadConfig()).toThrow();
  });

  it('configures private picture storage and bounded image/import limits', () => {
    for (const name of ['PROFILE_PICTURE_BUCKET', 'PROFILE_PICTURE_MAX_BYTES', 'PROFILE_PICTURE_MAX_PIXELS', 'PROFILE_PICTURE_MAX_DECODED_BYTES', 'PROFILE_PICTURE_IMPORT_TIMEOUT_MS', 'PROFILE_PICTURE_IMPORT_HOSTS']) delete process.env[name];
    expect(loadConfig()).toMatchObject({
      profilePictureBucket: 'profile-pictures', profilePictureMaxBytes: 5 * 1024 * 1024,
      profilePictureMaxPixels: 16_000_000, profilePictureMaxDecodedBytes: 64 * 1024 * 1024,
      profilePictureImportTimeoutMs: 10_000, profilePictureImportHosts: ['img.clerk.com', 'images.clerk.dev'],
    });
    process.env.PROFILE_PICTURE_MAX_BYTES = '1024';
    process.env.PROFILE_PICTURE_MAX_PIXELS = '64';
    process.env.PROFILE_PICTURE_MAX_DECODED_BYTES = '256';
    process.env.PROFILE_PICTURE_IMPORT_TIMEOUT_MS = '1000';
    expect(loadConfig()).toMatchObject({ profilePictureMaxBytes: 1024, profilePictureMaxPixels: 64, profilePictureMaxDecodedBytes: 256, profilePictureImportTimeoutMs: 1000 });
    for (const name of ['PROFILE_PICTURE_MAX_BYTES', 'PROFILE_PICTURE_MAX_PIXELS', 'PROFILE_PICTURE_MAX_DECODED_BYTES', 'PROFILE_PICTURE_IMPORT_TIMEOUT_MS']) {
      const previous = process.env[name];
      process.env[name] = '0';
      expect(() => loadConfig()).toThrow();
      process.env[name] = previous;
    }
  });

  it('defaults retained aliases to three and accepts a configurable non-negative limit', () => {
    delete process.env.PROFILE_RETAINED_ALIAS_LIMIT;
    expect(loadConfig().profileRetainedAliasLimit).toBe(3);
    process.env.PROFILE_RETAINED_ALIAS_LIMIT = '1';
    expect(loadConfig().profileRetainedAliasLimit).toBe(1);
    process.env.PROFILE_RETAINED_ALIAS_LIMIT = '0';
    expect(loadConfig().profileRetainedAliasLimit).toBe(0);
    process.env.PROFILE_RETAINED_ALIAS_LIMIT = '-1';
    expect(() => loadConfig()).toThrow();
  });

  it('accepts a short configured Handle maximum', () => {
    process.env.PROFILE_HANDLE_MAX_LENGTH = '3';

    expect(loadConfig().profileHandleMaxLength).toBe(3);
  });

  it('defaults the Display-name maximum when the environment value is missing or invalid', () => {
    delete process.env.PROFILE_DISPLAY_NAME_MAX_LENGTH;
    expect(loadConfig().profileDisplayNameMaxLength).toBe(80);

    process.env.PROFILE_DISPLAY_NAME_MAX_LENGTH = 'not-a-number';
    expect(loadConfig().profileDisplayNameMaxLength).toBe(80);
  });

  it('rejects a non-positive Display-name maximum', () => {
    process.env.PROFILE_DISPLAY_NAME_MAX_LENGTH = '0';

    expect(() => loadConfig()).toThrow();
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
