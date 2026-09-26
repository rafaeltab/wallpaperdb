import { expect, it } from 'vitest';
import { headers } from 'nats';
import { translateEvent } from '../src/adapters/events/index.js';
const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
const wallpaper = {
  id: 'wp',
  userId: 'user',
  fileType: 'image',
  mimeType: 'image/png',
  fileSizeBytes: 20,
  width: 2,
  height: 2,
  aspectRatio: 1,
  storageBucket: 'wallpapers',
  storageKey: 'wp.png',
  originalFilename: 'wp.png',
  uploadedAt: '2026-09-24T10:00:00.000Z',
};
it('translates a structured upload CloudEvent without losing its occurrence and correlation', () => {
  expect(
    translateEvent(
      'wallpaper.uploaded',
      encode({
        specversion: '1.0',
        source: 'https://wallpaperdb/ingestor',
        id: 'event-1',
        type: 'wallpaper.uploaded',
        time: '2026-09-24T10:00:00.000Z',
        datacontenttype: 'application/json',
        correlationid: 'flow-1',
        data: { wallpaper },
      })
    )
  ).toEqual({
    kind: 'wallpaper',
    occurrence: { source: 'https://wallpaperdb/ingestor', id: 'event-1' },
    occurredAt: '2026-09-24T10:00:00.000Z',
    correlationId: 'flow-1',
    wallpaper: {
      id: 'wp',
      mimeType: 'image/png',
      fileSizeBytes: 20,
      width: 2,
      height: 2,
      storageBucket: 'wallpapers',
      storageKey: 'wp.png',
      createdAt: '2026-09-24T10:00:00.000Z',
    },
  });
});
it('translates binary variant events with producer identity and the variant MIME type', () => {
  const header = headers();
  for (const [key, value] of Object.entries({
    'ce-specversion': '1.0',
    'ce-source': 'https://wallpaperdb/variant-generator',
    'ce-id': 'variant-1',
    'ce-type': 'wallpaper.variant.uploaded',
    'ce-time': '2026-09-24T10:00:00.000Z',
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
  }))
    header.set(key, value);
  const result = translateEvent(
    'wallpaper.variant.uploaded',
    encode({
      eventId: 'variant-1',
      eventType: 'wallpaper.variant.uploaded',
      timestamp: '2026-09-24T10:00:00.000Z',
      variant: {
        wallpaperId: 'wp',
        width: 1,
        height: 1,
        aspectRatio: 1,
        format: 'image/webp',
        fileSizeBytes: 10,
        storageBucket: 'wallpapers',
        storageKey: 'variant.webp',
        createdAt: '2026-09-24T10:00:00.000Z',
      },
    }),
    header
  );
  expect(result).toMatchObject({
    kind: 'variant',
    occurrence: { source: 'https://wallpaperdb/variant-generator', id: 'variant-1' },
    variant: { mimeType: 'image/webp', storageKey: 'variant.webp' },
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
  });
});
it('rejects malformed payloads, mismatched event types, and incomplete binary envelopes', () => {
  const event = {
    eventId: 'event-1',
    eventType: 'wallpaper.uploaded',
    timestamp: '2026-09-24T10:00:00.000Z',
    wallpaper,
  };
  expect(translateEvent('wallpaper.uploaded', new Uint8Array([255]))).toBeUndefined();
  expect(
    translateEvent(
      'wallpaper.uploaded',
      encode({ ...event, wallpaper: { ...wallpaper, width: 0 } })
    )
  ).toBeUndefined();
  expect(translateEvent('profile.created', encode(event))).toBeUndefined();
  const header = headers();
  header.set('ce-source', 'https://wallpaperdb/ingestor');
  expect(translateEvent('wallpaper.uploaded', encode(event), header)).toBeUndefined();
});
it('rejects contradictory binary metadata even when a valid structured upload is present', () => {
  const event = {
    specversion: '1.0',
    source: 'https://wallpaperdb/ingestor',
    id: 'event-1',
    type: 'wallpaper.uploaded',
    time: wallpaper.uploadedAt,
    datacontenttype: 'application/json',
    data: { wallpaper },
  };
  for (const override of [
    { 'ce-source': 'https://wallpaperdb/another-producer' },
    { 'ce-id': 'another-occurrence' },
    { 'ce-time': '2026-09-25T10:00:00.000Z' },
    { 'ce-specversion': '0.3' },
  ]) {
    const metadata = headers();
    for (const [key, value] of Object.entries({
      'ce-specversion': event.specversion,
      'ce-source': event.source,
      'ce-id': event.id,
      'ce-type': event.type,
      'ce-time': event.time,
      ...override,
    }))
      metadata.set(key, value);
    expect(translateEvent('wallpaper.uploaded', encode(event), metadata)).toBeUndefined();
  }
});
it('translates profile picture changes and retained snapshots without leaking other profile details', () => {
  const profile = {
    id: 'profile-1',
    displayName: 'Name',
    handle: 'handle',
    claimGeneration: 1,
    biographyMarkdown: 'private text',
    pictureAssetId: 'picture-1',
    version: 2,
    createdAt: '2026-09-24T10:00:00.000Z',
    updatedAt: '2026-09-24T10:00:00.000Z',
  };
  const event = {
    eventId: 'profile-change',
    eventType: 'profile.updated',
    timestamp: '2026-09-24T10:00:00.000Z',
    profile,
    change: {
      type: 'picture-changed',
      before: null,
      after: 'picture-1',
      source: 'upload',
      asset: {
        id: 'picture-1',
        storageBucket: 'pictures',
        storageKey: 'picture.webp',
        mimeType: 'image/webp',
        width: 128,
        height: 128,
        fileSizeBytes: 30,
      },
    },
  };
  expect(translateEvent('profile.updated', encode(event))).toEqual({
    kind: 'profile',
    occurrence: { source: 'wallpaperdb/user', id: 'profile-change' },
    occurredAt: '2026-09-24T10:00:00.000Z',
    profile: {
      id: 'profile-1',
      version: 2,
      pictureId: 'picture-1',
      updatedAt: '2026-09-24T10:00:00.000Z',
    },
    asset: {
      id: 'picture-1',
      storageBucket: 'pictures',
      storageKey: 'picture.webp',
      mimeType: 'image/webp',
      width: 128,
      height: 128,
      fileSizeBytes: 30,
      createdAt: '2026-09-24T10:00:00.000Z',
    },
  });
  expect(
    translateEvent(
      'profile.created',
      encode({ ...event, eventType: 'profile.created', change: { type: 'created' } })
    )
  ).toMatchObject({
    kind: 'profile',
    profile: { id: 'profile-1', version: 2, pictureId: 'picture-1' },
  });
  expect(translateEvent('profile.created', encode(event))).toBeUndefined();
});
it('rejects a binary envelope whose identity or type disagrees with its payload', () => {
  const event = {
    eventId: 'event-1',
    eventType: 'wallpaper.uploaded',
    timestamp: '2026-09-24T10:00:00.000Z',
    wallpaper,
  };
  const metadata = headers();
  for (const [key, value] of Object.entries({
    'ce-specversion': '1.0',
    'ce-source': 'https://wallpaperdb/ingestor',
    'ce-id': 'different',
    'ce-type': 'wallpaper.uploaded',
    'ce-time': '2026-09-24T10:00:00.000Z',
  }))
    metadata.set(key, value);
  expect(translateEvent('wallpaper.uploaded', encode(event), metadata)).toBeUndefined();
  metadata.set('ce-id', 'event-1');
  metadata.set('ce-type', 'profile.updated');
  expect(translateEvent('wallpaper.uploaded', encode(event), metadata)).toBeUndefined();
});
it('preserves validated structured and binary causation without confusing it with occurrence identity', () => {
  const structured = {
    specversion: '1.0',
    source: 'https://wallpaperdb/ingestor',
    id: 'upload-1',
    type: 'wallpaper.uploaded',
    time: '2026-09-24T10:00:00.000Z',
    datacontenttype: 'application/json',
    correlationid: 'workflow-1',
    causationid: 'command-1',
    causationsource: 'https://wallpaperdb/uploader',
    data: { wallpaper },
  };
  expect(translateEvent('wallpaper.uploaded', encode(structured))).toMatchObject({
    occurrence: { source: 'https://wallpaperdb/ingestor', id: 'upload-1' },
    correlationId: 'workflow-1',
    causationId: 'command-1',
    causationSource: 'https://wallpaperdb/uploader',
  });
  const metadata = headers();
  for (const [key, value] of Object.entries({
    'ce-specversion': '1.0',
    'ce-source': 'https://wallpaperdb/ingestor',
    'ce-id': 'upload-1',
    'ce-type': 'wallpaper.uploaded',
    'ce-time': '2026-09-24T10:00:00.000Z',
    'ce-correlationid': 'workflow-1',
    'ce-causationid': 'command-1',
    'ce-causationsource': 'https://wallpaperdb/uploader',
  }))
    metadata.set(key, value);
  expect(
    translateEvent(
      'wallpaper.uploaded',
      encode({
        eventId: 'upload-1',
        eventType: 'wallpaper.uploaded',
        timestamp: '2026-09-24T10:00:00.000Z',
        wallpaper,
      }),
      metadata
    )
  ).toMatchObject({
    occurrence: { source: 'https://wallpaperdb/ingestor', id: 'upload-1' },
    correlationId: 'workflow-1',
    causationId: 'command-1',
    causationSource: 'https://wallpaperdb/uploader',
  });
  expect(
    translateEvent('wallpaper.uploaded', encode({ ...structured, causationsource: 42 }))
  ).toBeUndefined();
});
