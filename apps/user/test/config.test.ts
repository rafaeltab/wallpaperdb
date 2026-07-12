import { describe, expect, it } from 'vitest';
import { configSchema } from '../src/config.js';

describe('Profile Handle configuration', () => {
  it('rejects a minimum length greater than the maximum', () => {
    const result = configSchema.safeParse({
      port: 3009,
      nodeEnv: 'test',
      databaseUrl: 'postgres://localhost/test',
      natsUrl: 'nats://localhost:4222',
      natsStream: 'WALLPAPER',
      otelServiceName: 'user',
      profileHandleMinLength: 31,
      profileHandleMaxLength: 30,
      profileHandleAllocationAttempts: 10,
      profileReservedHandles: [],
    });

    expect(result.success).toBe(false);
  });
});
