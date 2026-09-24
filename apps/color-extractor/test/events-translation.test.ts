import { expect, it } from 'vitest';
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
