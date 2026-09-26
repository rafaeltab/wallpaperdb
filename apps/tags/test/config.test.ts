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

  it.each([
    'https://database.example/tags',
    'postgresql:///tags',
    'not-a-url',
  ])('rejects unusable PostgreSQL connection URL %j', (databaseUrl) => {
    expect(() => loadConfig({ ...requiredEnvironment, DATABASE_URL: databaseUrl })).toThrow();
  });

  it.each([
    'https://nats.example',
    'ws://nats.example',
    'wss://nats.example',
    'nats://',
  ])('rejects unusable NATS connection URL %j', (natsUrl) => {
    expect(() => loadConfig({ ...requiredEnvironment, NATS_URL: natsUrl })).toThrow();
  });

  it('rejects an OTLP exporter URL that does not use HTTP', () => {
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        OTEL_EXPORTER_OTLP_ENDPOINT: 'ftp://collector.example:4318',
      })
    ).toThrow();
  });

  it.each([
    'postgres',
    'postgresql',
  ])('accepts configured services using the %s scheme', (protocol) => {
    expect(
      loadConfig({
        DATABASE_URL: `${protocol}://tags:password@127.0.0.1:5432/tags`,
        NATS_URL: 'tls://nats.example:4222',
        NODE_ENV: 'production',
        PORT: '4008',
        NATS_STREAM: 'CUSTOM',
        OTEL_SERVICE_NAME: 'tags-production',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example:4318',
      })
    ).toEqual({
      databaseUrl: `${protocol}://tags:password@127.0.0.1:5432/tags`,
      natsUrl: 'tls://nats.example:4222',
      nodeEnv: 'production',
      port: 4008,
      natsStream: 'CUSTOM',
      otelServiceName: 'tags-production',
      otelEndpoint: 'https://collector.example:4318',
    });
  });

  it('accepts an HTTP OTLP collector', () => {
    expect(
      loadConfig({
        ...requiredEnvironment,
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:4318',
      }).otelEndpoint
    ).toBe('http://127.0.0.1:4318');
  });

  it('does not disclose a credential-bearing URL in configuration failures', () => {
    expect(() =>
      loadConfig({
        ...requiredEnvironment,
        DATABASE_URL: 'https://tags:url-password@database.example/tags',
      })
    ).toThrowError(expect.not.stringContaining('url-password'));
  });

  it.each(['DATABASE_URL', 'NATS_URL'])('requires %s', (name) => {
    expect(() => loadConfig({ ...requiredEnvironment, [name]: undefined })).toThrow();
  });
});
