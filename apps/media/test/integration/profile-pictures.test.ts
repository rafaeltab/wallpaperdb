import 'reflect-metadata';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { PROFILE_UPDATED_SUBJECT, type ProfileUpdatedEvent } from '@wallpaperdb/events';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
  PostgresTesterBuilder,
} from '@wallpaperdb/test-utils';
import sharp from 'sharp';
import { container } from 'tsyringe';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { InProcessMediaTesterBuilder, MediaMigrationsTesterBuilder } from '../builders/index.js';

describe('Profile picture delivery', () => {
  const availability = new Map<string, number>();
  const authorityRequests: Array<{ url?: string; authorization?: string; cacheControl?: string }> = [];
  const authority = createServer((request, response) => {
    authorityRequests.push({ url: request.url, authorization: request.headers.authorization, cacheControl: request.headers['cache-control'] });
    response.setHeader('Cache-Control', 'no-store');
    if (request.headers.authorization !== 'Bearer test-media-token') {
      response.writeHead(401).end();
      return;
    }
    const pictureId = request.url?.match(/^\/internal\/profile-pictures\/([^/]+)\/availability$/)?.[1];
    response.writeHead(pictureId ? availability.get(pictureId) ?? 404 : 404).end();
  });
  const setup = () => {
    const Tester = createDefaultTesterBuilder()
      .with(DockerTesterBuilder)
      .with(PostgresTesterBuilder)
      .with(MinioTesterBuilder)
      .with(NatsTesterBuilder)
      .with(MediaMigrationsTesterBuilder)
      .with(InProcessMediaTesterBuilder)
      .build();
    return new Tester()
      .withPostgres((builder) => builder.withDatabase('test_profile_pictures'))
      .withMinio()
      .withMinioBucket('profile-pictures')
      .withNats((builder) => builder.withJetstream())
      .withStream('WALLPAPER')
      .withMigrations()
      .withInProcessApp();
  };
  let tester: ReturnType<typeof setup>;
  const previousUrl = process.env.USER_SERVICE_URL;
  const previousToken = process.env.USER_MEDIA_SERVICE_TOKEN;

  beforeAll(async () => {
    authority.listen(0, '127.0.0.1');
    await once(authority, 'listening');
    process.env.USER_SERVICE_URL = `http://127.0.0.1:${(authority.address() as AddressInfo).port}`;
    process.env.USER_MEDIA_SERVICE_TOKEN = 'test-media-token';
    container.clearInstances();
    tester = setup();
    await tester.setup();
  }, 60000);

  afterAll(async () => {
    await tester?.destroy();
    authority.close();
    authority.closeAllConnections();
    if (previousUrl === undefined) delete process.env.USER_SERVICE_URL;
    else process.env.USER_SERVICE_URL = previousUrl;
    if (previousToken === undefined) delete process.env.USER_MEDIA_SERVICE_TOKEN;
    else process.env.USER_MEDIA_SERVICE_TOKEN = previousToken;
  });

  beforeEach(() => {
    availability.clear();
    authorityRequests.length = 0;
  });

  async function pictureEvent(profileId: string, pictureId: string, version = 2): Promise<{ event: ProfileUpdatedEvent; bytes: Buffer }> {
    const bytes = await sharp({ create: { width: 32, height: 32, channels: 3, background: '#4b728a' } }).webp().toBuffer();
    const asset = {
      id: pictureId, storageBucket: 'profile-pictures', storageKey: `${profileId}/${pictureId}.webp`,
      mimeType: 'image/webp' as const, width: 32, height: 32, fileSizeBytes: bytes.length,
    };
    await tester.minio.uploadObject(asset.storageBucket, asset.storageKey, bytes);
    const timestamp = new Date().toISOString();
    return {
      bytes,
      event: {
        eventId: `evt_${pictureId}_${version}`, eventType: PROFILE_UPDATED_SUBJECT, timestamp,
        change: { type: 'picture-changed', before: null, after: pictureId, source: 'upload', asset },
        profile: {
          id: profileId, handle: profileId, displayName: 'Picture Owner', claimGeneration: 1,
          aliases: [], biographyMarkdown: '', pictureAssetId: pictureId, version,
          createdAt: timestamp, updatedAt: timestamp,
        },
      },
    };
  }

  function getPicture(pictureId: string) {
    return tester.getApp().inject({ method: 'GET', url: `/profile-pictures/${pictureId}` });
  }

  it('serves committed picture bytes from NATS metadata with immutable caching and authenticated authority checks', async () => {
    const { event, bytes } = await pictureEvent('user_picture_delivery', 'pic_delivery');
    availability.set('pic_delivery', 204);
    await tester.nats.publishEvent(PROFILE_UPDATED_SUBJECT, event);

    const response = await vi.waitFor(async () => {
      const response = await getPicture('pic_delivery');
      expect(response.statusCode).toBe(200);
      return response;
    }, { timeout: 5000, interval: 25 });

    expect(response.rawPayload).toEqual(bytes);
    expect(response.headers['content-type']).toBe('image/webp');
    expect(response.headers['content-length']).toBe(String(bytes.length));
    expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(response.headers.location).toBeUndefined();
    expect(authorityRequests).toContainEqual({
      url: '/internal/profile-pictures/pic_delivery/availability',
      authorization: 'Bearer test-media-token', cacheControl: 'no-store',
    });
  });
});
