import { ulid } from 'ulid';
import { getNatsClient } from '../connections/nats.js';
import type { Wallpaper } from '../db/schema.js';

export interface WallpaperUploadedEvent {
  eventId: string;
  eventType: 'wallpaper.uploaded';
  timestamp: string;
  wallpaper: {
    id: string;
    userId: string;
    fileType: 'image' | 'video';
    mimeType: string;
    fileSizeBytes: number;
    width: number;
    height: number;
    aspectRatio: number;
    storageKey: string;
    storageBucket: string;
    originalFilename: string;
    uploadedAt: string;
  };
}

/**
 * Publish wallpaper.uploaded event to NATS
 */
export async function publishWallpaperUploadedEvent(wallpaper: Wallpaper): Promise<void> {
  const nats = getNatsClient();

  if (
    !wallpaper.fileType ||
    !wallpaper.mimeType ||
    !wallpaper.width ||
    !wallpaper.height ||
    !wallpaper.fileSizeBytes ||
    !wallpaper.storageKey ||
    !wallpaper.storageBucket ||
    !wallpaper.originalFilename
  ) {
    throw new Error('Wallpaper data incomplete for event publishing');
  }

  const event: WallpaperUploadedEvent = {
    eventId: ulid(),
    eventType: 'wallpaper.uploaded',
    timestamp: new Date().toISOString(),
    wallpaper: {
      id: wallpaper.id,
      userId: wallpaper.userId,
      fileType: wallpaper.fileType,
      mimeType: wallpaper.mimeType,
      fileSizeBytes: wallpaper.fileSizeBytes,
      width: wallpaper.width,
      height: wallpaper.height,
      aspectRatio: wallpaper.width / wallpaper.height,
      storageKey: wallpaper.storageKey,
      storageBucket: wallpaper.storageBucket,
      originalFilename: wallpaper.originalFilename,
      uploadedAt: wallpaper.uploadedAt.toISOString(),
    },
  };

  // Publish to NATS JetStream
  const js = nats.jetstream();
  await js.publish('wallpaper.uploaded', JSON.stringify(event));
}
