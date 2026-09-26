import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
  NatsTesterBuilder,
  PostgresTesterBuilder,
} from '@wallpaperdb/test-utils';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  ContainerizedIngestorTesterBuilder,
  IngestorMigrationsTesterBuilder,
} from './builders/index.js';

const Tester = createDefaultTesterBuilder()
  .with(DockerTesterBuilder)
  .with(PostgresTesterBuilder)
  .with(S3TesterBuilder)
  .with(NatsTesterBuilder)
  .with(IngestorMigrationsTesterBuilder)
  .with(ContainerizedIngestorTesterBuilder)
  .build();

/** The suite exercises the Docker artifact; capability decision tables live with their owning ports. */
describe('deployed ingestor', () => {
  const tester = new Tester();
  let baseUrl: string;
  beforeAll(async () => {
    tester
      .withNetwork()
      .withPostgres()
      .withS3()
      .withS3Bucket('wallpapers')
      .withS3Bucket('asset-references')
      .withNats((builder) => builder.withJetstream())
      .withStream('WALLPAPER')
      .withMigrations()
      .withContainerizedApp();
    await tester.setup();
    baseUrl = tester.getBaseUrl();
  }, 120000);
  afterAll(async () => {
    await tester.destroy();
  });

  const upload = (bytes: Uint8Array, authenticated = true) => {
    const form = new FormData();
    form.append('file', new Blob([Buffer.from(bytes)], { type: 'image/png' }), 'wallpaper.png');
    return fetch(`${baseUrl}/upload`, {
      method: 'POST',
      body: form,
      headers: authenticated
        ? {
            authorization: `Bearer ${Buffer.from(JSON.stringify({ id: 'user_deployed' })).toString('base64')}`,
          }
        : {},
    });
  };

  it('initializes telemetry and serves health, readiness, and deployed OpenAPI documentation', async () => {
    const health = await fetch(`${baseUrl}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({
      status: 'healthy',
      checks: { database: true, s3: true, nats: true, otel: true },
    });
    const ready = await fetch(`${baseUrl}/ready`);
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({ ready: true });
    const documentation = await fetch(`${baseUrl}/documentation/json`);
    expect(documentation.status).toBe(200);
    expect(await documentation.json()).toMatchObject({ paths: { '/upload': expect.any(Object) } });
  });

  it('authenticates uploads and returns safe problem details for invalid content', async () => {
    const unauthorized = await upload(new Uint8Array([1]), false);
    expect(unauthorized.status).toBe(401);
    const invalid = await upload(new Uint8Array([1]));
    expect(invalid.status).toBe(400);
    expect(invalid.headers.get('content-type')).toContain('application/problem+json');
    expect(await invalid.json()).toMatchObject({
      status: 400,
      type: 'https://github.com/rafaeltab/wallpaperdb/blob/main/docs/problems/invalid-file-format.md',
    });
  });

  it('stores an upload, publishes its CloudEvent, and returns the same identity for a duplicate', async () => {
    const image = await sharp({
      create: { width: 1280, height: 720, channels: 3, background: '#123456' },
    })
      .png()
      .toBuffer();
    const response = await upload(image);
    expect(response.status).toBe(200);
    const receipt: unknown = await response.json();
    expect(receipt).toMatchObject({
      id: expect.stringMatching(/^wlpr_/),
      status: 'processing',
      fileType: 'image',
      width: 1280,
      height: 720,
    });
    if (
      typeof receipt !== 'object' ||
      receipt === null ||
      !('id' in receipt) ||
      typeof receipt.id !== 'string'
    )
      throw new Error('Upload response has no wallpaper identity');
    const id = receipt.id;
    expect(await tester.s3.listObjects('wallpapers')).toContain(`${id}/original.png`);
    const duplicate = await upload(image);
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ id, status: 'already_uploaded' });
    const connection = await tester.nats.getConnection();
    const manager = await connection.jetstreamManager();
    await vi.waitFor(
      async () => {
        expect((await manager.streams.info('WALLPAPER')).state.messages).toBe(1);
      },
      { timeout: 5000, interval: 50 }
    );
    const stored = await manager.streams.getMessage('WALLPAPER', {
      last_by_subj: 'wallpaper.uploaded',
    });
    const event = JSON.parse(new TextDecoder().decode(stored.data));
    expect(event).toMatchObject({
      specversion: '1.0',
      source: 'urn:wallpaperdb:ingestor',
      type: 'wallpaper.uploaded',
      id: expect.any(String),
      data: { wallpaper: { id, userId: 'user_deployed', asset: { owner: 'ingestor', id } } },
    });
    expect(event.data.wallpaper).not.toHaveProperty('storageBucket');
    expect(event.data.wallpaper).not.toHaveProperty('storageKey');
    expect(event.data.wallpaper).not.toHaveProperty('originalFilename');
  });
});
