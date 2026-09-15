import 'reflect-metadata';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { DeleteObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { PROFILE_CREATED_SUBJECT, PROFILE_UPDATED_SUBJECT, type ProfileUpdatedEvent } from '@wallpaperdb/events';
import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  MinioTesterBuilder,
  NatsTesterBuilder,
  PostgresTesterBuilder,
} from '@wallpaperdb/test-utils';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { container } from 'tsyringe';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { InProcessMediaTesterBuilder, MediaMigrationsTesterBuilder } from '../builders/index.js';
import { DatabaseConnection } from '../../src/connections/database.js';
import { profilePictureHeads } from '../../src/db/schema.js';

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
    const status = pictureId ? availability.get(pictureId) ?? 404 : 404;
    if (status === 0) request.socket.destroy();
    else response.writeHead(status).end();
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

  it('projects creation and newer non-picture snapshots before late picture metadata without losing delivery', async () => {
    const { event, bytes } = await pictureEvent('user_picture_order', 'pic_late_metadata');
    const created = {
      eventId: 'evt_picture_profile_created', eventType: PROFILE_CREATED_SUBJECT,
      timestamp: event.timestamp, change: { type: 'created' },
      profile: { ...event.profile, version: 1, pictureAssetId: null },
    };
    await tester.nats.publishEvent(PROFILE_CREATED_SUBJECT, created);
    const db = container.resolve(DatabaseConnection).getClient().db;
    await vi.waitFor(async () => {
      expect(await db.query.profilePictureHeads.findFirst({ where: eq(profilePictureHeads.profileId, event.profile.id) }))
        .toMatchObject({ version: 1, pictureId: null });
    }, { timeout: 5000, interval: 25 });

    availability.set('pic_late_metadata', 204);
    await tester.nats.publishEvent(PROFILE_UPDATED_SUBJECT, {
      ...event, eventId: 'evt_picture_newer_display_name',
      change: { type: 'display-name-changed', before: 'Before', after: 'After' },
      profile: { ...event.profile, version: 3, displayName: 'After' },
    });
    await vi.waitFor(async () => {
      expect(await db.query.profilePictureHeads.findFirst({ where: eq(profilePictureHeads.profileId, event.profile.id) }))
        .toMatchObject({ version: 3, pictureId: 'pic_late_metadata' });
    }, { timeout: 5000, interval: 25 });
    const waiting = await getPicture('pic_late_metadata');
    expect(waiting.statusCode).toBe(404);
    expect(waiting.headers['cache-control']).toBe('no-store');

    await tester.nats.publishEvent(PROFILE_UPDATED_SUBJECT, event);
    await vi.waitFor(async () => {
      const response = await getPicture('pic_late_metadata');
      expect(response.statusCode).toBe(200);
      expect(response.rawPayload).toEqual(bytes);
    }, { timeout: 5000, interval: 25 });
    await tester.nats.publishEvent(PROFILE_CREATED_SUBJECT, { ...created, eventId: 'evt_delayed_picture_creation' });
    const marker = { ...created, eventId: 'evt_picture_order_marker', profile: { ...created.profile, id: 'user_picture_order_marker' } };
    await tester.nats.publishEvent(PROFILE_CREATED_SUBJECT, marker);
    await vi.waitFor(async () => {
      expect(await db.query.profilePictureHeads.findFirst({ where: eq(profilePictureHeads.profileId, marker.profile.id) })).toBeDefined();
    }, { timeout: 5000, interval: 25 });
    expect((await getPicture('pic_late_metadata')).statusCode).toBe(200);
    expect(await db.query.profilePictureHeads.findFirst({ where: eq(profilePictureHeads.profileId, event.profile.id) }))
      .toMatchObject({ version: 3, pictureId: 'pic_late_metadata' });
  });

  it('rejects new GET and HEAD requests immediately after retirement despite stale projection and retains private bytes', async () => {
    const { event, bytes } = await pictureEvent('user_picture_retired', 'pic_retired');
    availability.set('pic_retired', 204);
    await tester.nats.publishEvent(PROFILE_UPDATED_SUBJECT, event);
    await vi.waitFor(async () => expect((await getPicture('pic_retired')).statusCode).toBe(200), { timeout: 5000, interval: 25 });

    // The User command has committed, but no retirement event has reached Media.
    availability.set('pic_retired', 404);
    const requestsBefore = authorityRequests.length;
    for (const method of ['GET', 'HEAD'] as const) {
      const response = await tester.getApp().inject({ method, url: '/profile-pictures/pic_retired', headers: { 'if-none-match': '*' } });
      expect(response.statusCode).toBe(404);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.location).toBeUndefined();
      expect(response.body).not.toContain('user_picture_retired/pic_retired.webp');
      expect(response.rawPayload).not.toEqual(bytes);
    }
    expect(authorityRequests).toHaveLength(requestsBefore + 2);
    const stored = await tester.minio.getS3Client().send(new GetObjectCommand({
      Bucket: 'profile-pictures', Key: 'user_picture_retired/pic_retired.webp',
    }));
    expect(Buffer.from(await stored.Body?.transformToByteArray() ?? [])).toEqual(bytes);
    const anonymous = await fetch(`${tester.minio.config.endpoints.fromHost}/profile-pictures/user_picture_retired/pic_retired.webp`);
    expect(anonymous.status).toBe(403);
    await anonymous.body?.cancel();
  });

  it('fails closed without caching authority and storage errors, allowing the same picture URL to recover', async () => {
    const { event, bytes } = await pictureEvent('user_picture_retry', 'pic_retry');
    availability.set('pic_retry', 204);
    await tester.nats.publishEvent(PROFILE_UPDATED_SUBJECT, event);
    await vi.waitFor(async () => expect((await getPicture('pic_retry')).statusCode).toBe(200), { timeout: 5000, interval: 25 });

    for (const status of [401, 403, 500, 302, 0]) {
      availability.set('pic_retry', status);
      const response = await getPicture('pic_retry');
      expect(response.statusCode).toBe(503);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.headers.location).toBeUndefined();
      expect(response.body).not.toContain('user_picture_retry/pic_retry.webp');
      expect(response.rawPayload).not.toEqual(bytes);
    }
    availability.set('pic_retry', 204);
    const key = 'user_picture_retry/pic_retry.webp';
    await tester.minio.getS3Client().send(new DeleteObjectCommand({ Bucket: 'profile-pictures', Key: key }));
    const missingObject = await getPicture('pic_retry');
    expect(missingObject.statusCode).toBe(503);
    expect(missingObject.headers['cache-control']).toBe('no-store');
    expect(missingObject.body).not.toContain(key);
    await tester.minio.uploadObject('profile-pictures', key, bytes);
    const recovered = await getPicture('pic_retry');
    expect(recovered.statusCode).toBe(200);
    expect(recovered.rawPayload).toEqual(bytes);
    expect(recovered.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });
});
