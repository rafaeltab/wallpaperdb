import { inject, injectable } from 'tsyringe';
import { ulid } from 'ulid';
import {
  type WallpaperUploadedEvent,
  WALLPAPER_UPLOADED_SUBJECT,
} from '@wallpaperdb/events/schemas';
import type { Wallpaper } from '../db/schema.js';
import { NatsConnectionManager } from '../connections/nats.js';

// Re-export for backwards compatibility
export type { WallpaperUploadedEvent } from '@wallpaperdb/events/schemas';

@injectable()
export class EventsService {
  constructor(@inject(NatsConnectionManager) private readonly natsClient: NatsConnectionManager) {}

  /**
   * Publish wallpaper.uploaded event to NATS
   */
  async publishUploadedEvent(wallpaper: Wallpaper): Promise<void> {
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
    const js = this.natsClient.getClient().jetstream();
    await js.publish(WALLPAPER_UPLOADED_SUBJECT, JSON.stringify(event));
  }
}
