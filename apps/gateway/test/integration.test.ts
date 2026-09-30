import { Client } from '@opensearch-project/opensearch';
import type { ProfileUpdatedEvent, WallpaperUploadedEvent } from '@wallpaperdb/events';
import { Effect } from 'effect';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { OpenSearchGateway } from '../src/adapters/opensearch/index.js';
import { createGatewayTester } from './setup.js';
import { createApp } from '../src/app.js';
import { acquireSearchFixture, createSearchFixture } from './search-fixture.js';
import { measuredColors } from './helpers/colors.js';

const timestamp = '2026-09-15T12:00:00.000Z';

describe('Gateway composition with real adapters', () => {
  const tester = createGatewayTester();
  const adapters: Array<Awaited<ReturnType<typeof acquireSearchFixture>>> = [];
  beforeAll(async () => {
    await tester.setup();
  });
  afterEach(async () => {
    await Promise.all(adapters.splice(0).map((adapter) => adapter.dispose()));
  });
  afterAll(async () => {
    await tester.destroy();
  });

  async function adapter(wallpaperIndex: string, profileIndex: string) {
    const value = await acquireSearchFixture({
      url: tester.search.options.url,
      wallpaperIndex,
      profileIndex,
    });
    adapters.push(value);
    return value.adapter;
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

  it('projects retained actual-image measurements into the complete bank and default GraphQL ranking', async () => {
    const id = 'wlpr_color_composition';
    const profileId = 'user_color_composition';
    const measured = measuredColors(id, timestamp);
    // This descriptor is the frozen extraction result of color-extractor's red.png.
    // Its decoding/publication contracts run in that workspace; this seam starts at the event.
    const event = {
      specversion: '1.0',
      source: measured.occurrence.source,
      id: measured.occurrence.id,
      type: 'wallpaper.colors.extracted',
      time: timestamp,
      datacontenttype: 'application/json',
      data: {
        schemaVersion: 1,
        wallpaperId: id,
        original: measured.original,
        provenance: {
          ...measured.provenance,
          originalSha256: '3a980711ab31ee89a710d34a74683686cfcae15a9ef3905245e3439837e5d54a',
        },
        measurements: measured.descriptor,
      },
    };
    const js = await tester.nats.getJsClient();
    await js.publish(event.type, JSON.stringify(event));
    const upload: WallpaperUploadedEvent = {
      eventId: 'evt_color_composition_upload',
      eventType: 'wallpaper.uploaded',
      timestamp,
      wallpaper: {
        id,
        userId: profileId,
        fileType: 'image',
        mimeType: 'image/png',
        fileSizeBytes: 100,
        width: 128,
        height: 128,
        aspectRatio: 1,
        storageKey: 'gateway/red.png',
        storageBucket: 'wallpapers',
        originalFilename: 'red.png',
        uploadedAt: timestamp,
      },
    };
    await js.publish(upload.eventType, JSON.stringify(upload));
    await expect
      .poll(
        async () => {
          const response = await tester.getApp().inject({
            method: 'POST',
            url: '/graphql',
            payload: {
              query: `{
              vibe: searchWallpapers(filter:{profileId:"${profileId}"},sort:{color:{targets:[{color:"#ff0000"}]}}) { edges {node{wallpaperId profileId}} pageInfo{endCursor} }
              repeated: searchWallpapers(filter:{profileId:"${profileId}"},sort:{color:{mode:PROPORTIONS,targets:[{color:"#ff0000",percent:100},{name:RED,percent:100}]}}) { edges {node{wallpaperId profileId}} pageInfo{endCursor} }
          }`,
            },
          });
          const body = response.json();
          if (body.errors) throw new Error(JSON.stringify(body.errors));
          return body;
        },
        { timeout: 10000, interval: 25 }
      )
      .toMatchObject({
        data: {
          vibe: {
            edges: [{ node: { wallpaperId: id, profileId } }],
            pageInfo: { endCursor: expect.any(String) },
          },
          repeated: {
            edges: [{ node: { wallpaperId: id, profileId } }],
            pageInfo: { endCursor: expect.any(String) },
          },
        },
      });
    const client = new Client({ node: tester.search.options.url });
    try {
      const result = await client.get({ index: tester.search.options.wallpaperIndex, id });
      expect(result.body._source).toMatchObject({
        colorReady: 'linked-3-linear-10-v1',
        colorSnapshot: { descriptor: measured.descriptor, provenance: event.data.provenance },
      });
      expect(result.body._source.utilities).toBeUndefined();
    } finally {
      await client.close();
    }
  });

  it('projects a Profile update into public discovery and canonical alias resolution', async () => {
    const event: ProfileUpdatedEvent = {
      eventId: 'evt_profile_discovery_integration',
      eventType: 'profile.updated',
      timestamp,
      change: {
        type: 'picture-changed',
        before: null,
        after: 'picture_integration',
        source: 'upload',
        asset: {
          id: 'picture_integration',
          storageBucket: 'private-profile-pictures',
          storageKey: 'private/integration.webp',
          mimeType: 'image/webp',
          width: 256,
          height: 256,
          fileSizeBytes: 1024,
        },
      },
      profile: {
        id: 'profile_discovery_integration',
        handle: 'integration-artist',
        displayName: 'Integration Artist',
        biographyMarkdown: '  # Authored biography\n\n**Preserved**\n',
        pictureAssetId: 'picture_integration',
        claimGeneration: 2,
        aliases: [
          {
            handle: 'former-integration-artist',
            claimGeneration: 1,
            createdAt: timestamp,
            expiresAt: null,
          },
        ],
        version: 2,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    };
    const js = await tester.nats.getJsClient();
    await js.publish(event.eventType, JSON.stringify(event));
    await expect
      .poll(
        async () => {
          const response = await tester.getApp().inject({
            method: 'POST',
            url: '/graphql',
            payload: {
              query: `{
            profileByHandle(handle:"FORMER-INTEGRATION-ARTIST") {
              requestedHandle isAlias canonicalHandle
              profile {id version biographyMarkdown picture{id}}
            }
            searchProfiles(query:"integration-artist") {
              edges {node {id handle}}
            }
          }`,
            },
          });
          return response.json();
        },
        { timeout: 10000, interval: 25 }
      )
      .toEqual({
        data: {
          profileByHandle: {
            requestedHandle: 'FORMER-INTEGRATION-ARTIST',
            isAlias: true,
            canonicalHandle: 'integration-artist',
            profile: {
              id: event.profile.id,
              version: 2,
              biographyMarkdown: event.profile.biographyMarkdown,
              picture: { id: 'picture_integration' },
            },
          },
          searchProfiles: {
            edges: [{ node: { id: event.profile.id, handle: 'integration-artist' } }],
          },
        },
      });
  });

  it('creates named indexes with independent Profile and color-search mappings, and starts idempotently', async () => {
    const wallpaperIndex = tester.search.index('lifecycle_wallpapers');
    const profileIndex = tester.search.index('lifecycle_profiles');
    const search = await adapter(wallpaperIndex, profileIndex);
    const repeated = await adapter(wallpaperIndex, profileIndex);
    expect(await Effect.runPromise(search.check())).toBe(true);
    expect(await Effect.runPromise(repeated.check())).toBe(true);
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
              utilities: { dynamic: 'strict' },
              colorReady: { type: 'keyword' },
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
        [wallpaperIndex]: {
          settings: { index: { mapping: { total_fields: { limit: '10100' } } } },
        },
      });
    } finally {
      await client.close();
    }
  });

  it('converges concurrent gateway startup on the same index names', async () => {
    const wallpaperIndex = tester.search.index('concurrent_wallpapers');
    const profileIndex = tester.search.index('concurrent_profiles');
    const [first, second] = await Promise.all([
      adapter(wallpaperIndex, profileIndex),
      adapter(wallpaperIndex, profileIndex),
    ]);
    expect(await Effect.runPromise(first.check())).toBe(true);
    expect(await Effect.runPromise(second.check())).toBe(true);
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
    ).rejects.toMatchObject({ _tag: 'NatsProjectionStartupError' });
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
    const [firstResource, secondResource] = await Promise.all([
      acquireSearchFixture(firstFixture.options),
      acquireSearchFixture(secondFixture.options),
    ]);
    adapters.push(firstResource, secondResource);
    const first = firstResource.adapter;
    const second = secondResource.adapter;
    const client = new Client({ node: firstFixture.options.url });
    try {
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
        profileId: 'first',
      });
      expect(await Effect.runPromise(second.read.wallpaper('shared-wallpaper'))).toMatchObject({
        profileId: 'second',
      });
      expect(await Effect.runPromise(first.read.profile('shared-profile'))).toMatchObject({
        displayName: 'first',
      });
      expect(await Effect.runPromise(second.read.profile('shared-profile'))).toMatchObject({
        displayName: 'second',
      });
      expect(await Effect.runPromise(first.read.profileByHandle('second'))).toBeNull();
      expect(await Effect.runPromise(second.read.profileByHandle('first'))).toBeNull();
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
        profileId: 'second',
      });
      expect(await Effect.runPromise(second.read.profile('shared-profile'))).toMatchObject({
        displayName: 'second',
      });
    } finally {
      await client.close();
      await Promise.all([firstFixture.destroy(), secondFixture.destroy()]);
    }
  });

  it('fails layer acquisition with a typed startup error when the search cluster is unreachable', async () => {
    await expect(acquireSearchFixture({ url: 'http://127.0.0.1:1' })).rejects.toMatchObject({
      _tag: 'OpenSearchStartupError',
    });
  });
});
