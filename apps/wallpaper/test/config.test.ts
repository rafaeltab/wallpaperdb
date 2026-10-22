import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const requiredEnvironment = {
  DATABASE_URL: 'postgresql://wallpaper:password@127.0.0.1:5432/wallpaper',
  NATS_URL: 'nats://127.0.0.1:4222',
};

describe('wallpaper configuration', () => {
  it('uses the service defaults when only required configuration is supplied', () => {
    expect(loadConfig(requiredEnvironment)).toEqual({
      databaseUrl: 'postgresql://wallpaper:password@127.0.0.1:5432/wallpaper',
      natsUrl: 'nats://127.0.0.1:4222',
      port: 3010,
      nodeEnv: 'development',
      otelServiceName: 'wallpaper',
      otelEndpoint: undefined,
    });
  });

  it.each([
    '3010oops',
    '3010.5',
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
    'https://database.example/wallpaper',
    'postgresql:///wallpaper',
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
        DATABASE_URL: `${protocol}://wallpaper:password@127.0.0.1:5432/wallpaper`,
        NATS_URL: 'tls://nats.example:4222',
        NODE_ENV: 'production',
        PORT: '4010',
        OTEL_SERVICE_NAME: 'wallpaper-production',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'https://collector.example:4318',
      })
    ).toEqual({
      databaseUrl: `${protocol}://wallpaper:password@127.0.0.1:5432/wallpaper`,
      natsUrl: 'tls://nats.example:4222',
      nodeEnv: 'production',
      port: 4010,
      otelServiceName: 'wallpaper-production',
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
        DATABASE_URL: 'https://wallpaper:url-password@database.example/wallpaper',
      })
    ).toThrowError(expect.not.stringContaining('url-password'));
  });

  it.each(['DATABASE_URL', 'NATS_URL'])('requires %s', (name) => {
    expect(() => loadConfig({ ...requiredEnvironment, [name]: undefined })).toThrow();
  });
});
