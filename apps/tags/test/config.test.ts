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

  it.each([
    '3008oops',
    '3008.5',
    '1e3',
    '',
    ' ',
    'Infinity',
    'NaN',
    '-1',
    '0',
    '65536',
  ])('rejects invalid listen port %j before startup', (port) => {
    expect(() => loadConfig({ ...requiredEnvironment, PORT: port })).toThrow();
  });

  it.each([
    ['1', 1],
    ['65535', 65535],
  ])('accepts listen port %s', (port, expected) => {
    expect(loadConfig({ ...requiredEnvironment, PORT: port }).port).toBe(expected);
  });
});
