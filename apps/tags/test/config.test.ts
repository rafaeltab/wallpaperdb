import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const requiredEnvironment = {
  DATABASE_URL: 'postgresql://tags:password@127.0.0.1:5432/tags',
  NATS_URL: 'nats://127.0.0.1:4222',
};

describe('tags configuration', () => {
  it('uses the service defaults when only required configuration is supplied', () => {
    expect(loadConfig(requiredEnvironment)).toEqual({
      databaseUrl: 'postgresql://tags:password@127.0.0.1:5432/tags',
      natsUrl: 'nats://127.0.0.1:4222',
      port: 3008,
      nodeEnv: 'development',
      natsStream: 'WALLPAPER',
      otelServiceName: 'tags',
      otelEndpoint: undefined,
    });
  });
});
