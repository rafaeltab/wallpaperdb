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
import { createSearchFixture } from './search-fixture.js';

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
    const value = createOpenSearchGateway({
      url: tester.search.options.url,
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
    const wallpaperIndex = tester.search.index('lifecycle_wallpapers');
    const profileIndex = tester.search.index('lifecycle_profiles');
    const search = adapter(wallpaperIndex, profileIndex);
    await search.start();
    await search.start();
    expect(await search.check()).toBe(true);
    const client = new Client({ node: tester.search.options.url });
    try {
      const mappings = await client.indices.getMapping({
        index: `${wallpaperIndex},${profileIndex}`,
      });
      expect(mappings.body).toMatchObject({
        [wallpaperIndex]: {
          mappings: {
            properties: {
              wallpaperId: { type: 'keyword' },
              variants: { type: 'nested' },
              colorHistogram: { type: 'knn_vector', dimension: 64 },
            },
          },
        },
        [profileIndex]: {
          mappings: {
            properties: {
              id: { type: 'keyword' },
              handle: { type: 'keyword' },
              version: { type: 'long' },
            },
          },
        },
      });
      const settings = await client.indices.getSettings({ index: wallpaperIndex });
      expect(settings.body).toMatchObject({
        [wallpaperIndex]: { settings: { index: { knn: 'true' } } },
      });
    } finally {
      await client.close();
    }
  });

  it('converges concurrent gateway startup on the same index names', async () => {
    const wallpaperIndex = tester.search.index('concurrent_wallpapers');
    const profileIndex = tester.search.index('concurrent_profiles');
    const first = adapter(wallpaperIndex, profileIndex);
    const second = adapter(wallpaperIndex, profileIndex);
    await Promise.all([first.start(), second.start()]);
    expect(await first.check()).toBe(true);
    expect(await second.check()).toBe(true);
  });

  it('fails safely after acquiring search resources when broker startup fails', async () => {
    const wallpaperIndex = tester.search.index('failed_startup_wallpapers');
    await expect(
      createApp(
        {
          ...tester.getGatewayConfig(),
          opensearchIndex: wallpaperIndex,
          natsUrl: 'nats://127.0.0.1:1',
        },
        { logger: false, enableOtel: false }
      )
    ).rejects.toThrow('Gateway startup failed');
    const client = new Client({ node: tester.search.options.url });
    try {
      expect((await client.indices.exists({ index: wallpaperIndex })).body).toBe(true);
    } finally {
      await client.close();
    }
    // The already-running gateway remains independently owned and healthy.
    expect((await tester.getApp().inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
  });

  it('isolates shared-cluster fixtures and deletes only the owning fixture indices', async () => {
    const firstFixture = createSearchFixture();
    const secondFixture = createSearchFixture();
    const first = createOpenSearchGateway(firstFixture.options);
    const second = createOpenSearchGateway(secondFixture.options);
    adapters.push(first, second);
    const client = new Client({ node: firstFixture.options.url });
    try {
      await Promise.all([first.start(), second.start()]);
      for (const [search, name] of [
        [first, 'first'],
        [second, 'second'],
      ] satisfies [OpenSearchGateway, string][]) {
        expect(
          await Effect.runPromise(
            search.projectionStore.apply({
              _tag: 'PublishWallpaper',
              wallpaperId: 'shared-wallpaper',
              profileId: name,
              uploadedAt: timestamp,
              occurrence: { source: 'test', id: name, occurredAt: timestamp },
            })
          )
        ).toEqual({ _tag: 'Applied' });
        expect(
          await Effect.runPromise(
            search.projectionStore.apply({
              _tag: 'PublishProfile',
              profile: {
                id: 'shared-profile',
                displayName: name,
                handle: name,
                claimGeneration: 1,
                biographyMarkdown: '',
                pictureAssetId: null,
                version: 1,
                createdAt: timestamp,
                updatedAt: timestamp,
              },
              occurrence: { source: 'test', id: `profile-${name}`, occurredAt: timestamp },
            })
          )
        ).toEqual({ _tag: 'Applied' });
      }
      expect(await Effect.runPromise(first.read.wallpaper('shared-wallpaper'))).toMatchObject({
        _tag: 'Found',
        value: { profileId: 'first' },
      });
      expect(await Effect.runPromise(second.read.wallpaper('shared-wallpaper'))).toMatchObject({
        _tag: 'Found',
        value: { profileId: 'second' },
      });
      expect(await Effect.runPromise(first.read.profile('shared-profile'))).toMatchObject({
        _tag: 'Found',
        value: { displayName: 'first' },
      });
      expect(await Effect.runPromise(second.read.profile('shared-profile'))).toMatchObject({
        _tag: 'Found',
        value: { displayName: 'second' },
      });
      expect(await Effect.runPromise(first.read.profileByHandle('second'))).toEqual({
        _tag: 'Found',
        value: null,
      });
      expect(await Effect.runPromise(second.read.profileByHandle('first'))).toEqual({
        _tag: 'Found',
        value: null,
      });
      const closedIndex = firstFixture.index('closed');
      await client.indices.create({ index: closedIndex });
      await client.indices.close({ index: closedIndex });
      await firstFixture.destroy();
      expect(
        (await client.indices.exists({ index: firstFixture.options.wallpaperIndex })).body
      ).toBe(false);
      expect((await client.indices.exists({ index: firstFixture.options.profileIndex })).body).toBe(
        false
      );
      expect((await client.indices.exists({ index: closedIndex })).body).toBe(false);
      expect(await Effect.runPromise(second.read.wallpaper('shared-wallpaper'))).toMatchObject({
        _tag: 'Found',
        value: { profileId: 'second' },
      });
      expect(await Effect.runPromise(second.read.profile('shared-profile'))).toMatchObject({
        _tag: 'Found',
        value: { displayName: 'second' },
      });
    } finally {
      await client.close();
      await Promise.all([firstFixture.destroy(), secondFixture.destroy()]);
    }
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
