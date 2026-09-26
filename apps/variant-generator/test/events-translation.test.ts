import { expect, it } from 'vitest';
import { headers } from 'nats';
import { translateUpload } from '../src/adapters/events/index.js';
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
it('translates historical uploads and preserves CloudEvent occurrence and correlation', () => {
  const legacy = {
    eventId: 'legacy',
    eventType: 'wallpaper.uploaded',
    timestamp: wallpaper.uploadedAt,
    wallpaper,
  };
  const cloud = {
    specversion: '1.0',
    id: 'cloud',
    source: 'https://wallpaperdb/ingestor',
    type: 'wallpaper.uploaded',
    time: wallpaper.uploadedAt,
    datacontenttype: 'application/json',
    correlationid: 'flow',
    data: { wallpaper },
  };
  const encode = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  expect(translateUpload(encode(legacy))).toEqual({
    wallpaperId: 'wp',
    fileType: 'image',
    mimeType: 'image/png',
    width: 2,
    height: 2,
    storage: { bucket: 'wallpapers', key: 'wp.png' },
    occurrence: { source: 'wallpaperdb/ingestor', id: 'legacy' },
    timestamp: wallpaper.uploadedAt,
  });
  expect(translateUpload(encode(cloud))).toMatchObject({
    occurrence: { source: cloud.source, id: 'cloud' },
    correlationId: 'flow',
  });
  expect(translateUpload(encode({ ...cloud, specversion: '0.3' }))).toBeUndefined();
  expect(translateUpload(new Uint8Array([0xff]))).toBeUndefined();
});

it('preserves binary CloudEvent occurrence and rejects conflicting transport metadata', () => {
  const event = {
    eventId: 'binary-occurrence',
    eventType: 'wallpaper.uploaded',
    timestamp: wallpaper.uploadedAt,
    wallpaper,
  };
  const metadata = headers();
  for (const [key, value] of Object.entries({
    'ce-specversion': '1.0',
    'ce-source': 'https://wallpaperdb/ingestor',
    'ce-id': event.eventId,
    'ce-type': event.eventType,
    'ce-time': event.timestamp,
    'ce-correlationid': 'upload-flow',
    'ce-causationid': 'upload-command',
  }))
    metadata.set(key, value);
  const bytes = new TextEncoder().encode(JSON.stringify(event));
  expect(translateUpload(bytes, metadata)).toMatchObject({
    occurrence: { source: 'https://wallpaperdb/ingestor', id: event.eventId },
    correlationId: 'upload-flow',
    causationId: 'upload-command',
  });
  metadata.set('ce-time', '2026-09-25T10:00:00.000Z');
  expect(translateUpload(bytes, metadata)).toBeUndefined();
});

it('translates an immutable logical original reference without object storage coordinates', () => {
  const {
    storageBucket: _bucket,
    storageKey: _key,
    originalFilename: _name,
    ...metadata
  } = wallpaper;
  const asset = { owner: 'ingestor', id: wallpaper.id };
  const event = {
    specversion: '1.0',
    source: 'https://wallpaperdb/ingestor',
    id: 'logical-original',
    type: 'wallpaper.uploaded',
    time: wallpaper.uploadedAt,
    datacontenttype: 'application/json',
    data: { wallpaper: { ...metadata, asset } },
  };
  expect(translateUpload(new TextEncoder().encode(JSON.stringify(event)))).toMatchObject({
    wallpaperId: wallpaper.id,
    storage: asset,
  });
});

it.each(['correlationid', 'causationid', 'causationsource'])(
  'requires matching %s across structured and binary envelopes',
  (extension) => {
    const event = {
      specversion: '1.0',
      source: 'https://wallpaperdb/ingestor',
      id: 'extension-agreement',
      type: 'wallpaper.uploaded',
      time: wallpaper.uploadedAt,
      datacontenttype: 'application/json',
      [extension]: 'https://wallpaperdb/original',
      data: { wallpaper },
    };
    const metadata = headers();
    for (const [key, value] of Object.entries({
      specversion: event.specversion,
      source: event.source,
      id: event.id,
      type: event.type,
      time: event.time,
      [extension]: 'https://wallpaperdb/original',
    }))
      metadata.set(`ce-${key}`, value);
    let bytes = new TextEncoder().encode(JSON.stringify(event));
    expect(translateUpload(bytes, metadata)).toBeDefined();
    metadata.set(`ce-${extension}`, 'https://wallpaperdb/different');
    expect(translateUpload(bytes, metadata)).toBeUndefined();
    metadata.delete(`ce-${extension}`);
    expect(translateUpload(bytes, metadata)).toBeUndefined();
    metadata.set(`ce-${extension}`, 'https://wallpaperdb/original');
    bytes = new TextEncoder().encode(JSON.stringify({ ...event, [extension]: undefined }));
    expect(translateUpload(bytes, metadata)).toBeUndefined();
  }
);
