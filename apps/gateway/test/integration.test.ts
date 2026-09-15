import { Client } from '@opensearch-project/opensearch';
import type { WallpaperUploadedEvent } from '@wallpaperdb/events';
import { Effect } from 'effect';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createOpenSearchGateway,
  type OpenSearchGateway,
} from '../src/adapters/opensearch/index.js';
import { createGatewayTester } from './setup.js';
import { createApp } from '../src/app.js';

const timestamp = '2026-09-15T12:00:00.000Z';

describe('Gateway composition with real adapters', () => {
  const tester = createGatewayTester();
  const adapters: OpenSearchGateway[] = [];
  beforeAll(async () => {
    await tester.setup();
  });
  afterEach(async () => {
    await Promise.all(adapters.splice(0).map((adapter) => adapter.stop()));
  });
  afterAll(async () => {
    await tester.destroy();
  });

  function adapter(wallpaperIndex: string, profileIndex: string): OpenSearchGateway {
    const search = tester.opensearch.config;
    const value = createOpenSearchGateway({
      url: search.endpoint.fromHost,
      username: search.username,
      password: search.password,
      wallpaperIndex,
      profileIndex,
    });
    adapters.push(value);
    return value;
  }

  it('projects a published upload and serves it through GraphQL with healthy readiness', async () => {
    const event: WallpaperUploadedEvent = {
      eventId: 'evt_gateway_integration',
      eventType: 'wallpaper.uploaded',
      timestamp,
      wallpaper: {
        id: 'wlpr_gateway_integration',
        userId: 'user_gateway_integration',
        fileType: 'image',
        mimeType: 'image/jpeg',
        fileSizeBytes: 100,
        width: 1920,
        height: 1080,
        aspectRatio: 1920 / 1080,
        storageKey: 'gateway/original.jpg',
        storageBucket: 'wallpapers',
        originalFilename: 'fixture.jpg',
        uploadedAt: timestamp,
      },
    };
    const js = await tester.nats.getJsClient();
    await js.publish('wallpaper.uploaded', JSON.stringify(event));
    const app = tester.getApp();
    await expect
      .poll(
        async () => {
          const response = await app.inject({
            method: 'POST',
            url: '/graphql',
            payload: {
              query:
                '{ getWallpaper(wallpaperId: "wlpr_gateway_integration") { wallpaperId profileId variants { width } } }',
            },
          });
          return response.json();
        },
        { timeout: 10000, interval: 25 }
      )
      .toEqual({
        data: {
          getWallpaper: {
            wallpaperId: 'wlpr_gateway_integration',
            profileId: 'user_gateway_integration',
            variants: [],
          },
        },
      });
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({
      status: 'healthy',
      checks: { opensearch: true, nats: true, otel: true },
    });
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json()).toMatchObject({ ready: true });
  });

  it('creates named indexes with independent Profile and color-search mappings, and starts idempotently', async () => {
    const search = adapter('lifecycle_wallpapers', 'lifecycle_profiles');
    await search.start();
    await search.start();
    expect(await search.check()).toBe(true);
    const client = new Client({ node: tester.opensearch.config.endpoint.fromHost });
    try {
      const mappings = await client.indices.getMapping({
        index: 'lifecycle_wallpapers,lifecycle_profiles',
      });
      expect(mappings.body).toMatchObject({
        lifecycle_wallpapers: {
          mappings: {
            properties: {
              wallpaperId: { type: 'keyword' },
              variants: { type: 'nested' },
              colorHistogram: { type: 'knn_vector', dimension: 64 },
            },
          },
        },
        lifecycle_profiles: {
          mappings: {
            properties: {
              id: { type: 'keyword' },
              handle: { type: 'keyword' },
              version: { type: 'long' },
            },
          },
        },
      });
      const settings = await client.indices.getSettings({ index: 'lifecycle_wallpapers' });
      expect(settings.body).toMatchObject({
        lifecycle_wallpapers: { settings: { index: { knn: 'true' } } },
      });
    } finally {
      await client.close();
    }
  });

  it('converges concurrent gateway startup on the same index names', async () => {
    const first = adapter('concurrent_wallpapers', 'concurrent_profiles');
    const second = adapter('concurrent_wallpapers', 'concurrent_profiles');
    await Promise.all([first.start(), second.start()]);
    expect(await first.check()).toBe(true);
    expect(await second.check()).toBe(true);
  });

  it('fails safely after acquiring search resources when broker startup fails', async () => {
    await expect(
      createApp(
        {
          ...tester.getGatewayConfig(),
          opensearchIndex: 'failed_startup_wallpapers',
          natsUrl: 'nats://127.0.0.1:1',
        },
        { logger: false, enableOtel: false }
      )
    ).rejects.toThrow('Gateway startup failed');
    const client = new Client({ node: tester.opensearch.config.endpoint.fromHost });
    try {
      expect((await client.indices.exists({ index: 'failed_startup_wallpapers' })).body).toBe(true);
    } finally {
      await client.close();
    }
    // The already-running gateway remains independently owned and healthy.
    expect((await tester.getApp().inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  it('translates an unreachable search cluster into unavailable read/write outcomes', async () => {
    const search = createOpenSearchGateway({ url: 'http://127.0.0.1:1' });
    adapters.push(search);
    await expect(search.start()).rejects.toThrow();
    expect(await search.check()).toBe(false);
    expect(await Effect.runPromise(search.read.wallpaper('missing'))).toEqual({
      _tag: 'Unavailable',
    });
    expect(await Effect.runPromise(search.read.profile('missing'))).toEqual({
      _tag: 'Unavailable',
    });
    expect(await Effect.runPromise(search.read.profileByHandle('missing'))).toEqual({
      _tag: 'Unavailable',
    });
    expect(await Effect.runPromise(search.read.profiles(['missing']))).toEqual({
      _tag: 'Unavailable',
    });
    expect(await Effect.runPromise(search.read.search({ size: 1, sortOrder: 'asc' }))).toEqual({
      _tag: 'Unavailable',
    });
    expect(
      await Effect.runPromise(
        search.projectionStore.apply({
          _tag: 'PublishWallpaper',
          wallpaperId: 'missing',
          profileId: 'owner',
          uploadedAt: timestamp,
          occurrence: { source: 'test', id: 'missing', occurredAt: timestamp },
        })
      )
    ).toEqual({ _tag: 'Unavailable' });
  });
});
