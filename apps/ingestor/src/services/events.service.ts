import { inject, injectable } from 'tsyringe';
import type { Config } from '../config.js';
import type { Wallpaper } from '../db/schema.js';
import { NatsConnectionManager } from '../connections/nats.js';
import { WallpaperUploadedPublisher } from './publishers/wallpaper-uploaded.publisher.js';

// Re-export for backwards compatibility
export type { WallpaperUploadedEvent } from '@wallpaperdb/events/schemas';

/**
 * Service for publishing wallpaper-related events to NATS.
 *
 * Uses the new BaseEventPublisher infrastructure which provides:
 * - Zod schema validation before publishing
 * - OpenTelemetry trace context propagation
 * - Automatic telemetry spans and metrics
 */
@injectable()
export class EventsService {
  private publisher: WallpaperUploadedPublisher | null = null;

  constructor(
    @inject(NatsConnectionManager) private readonly natsClient: NatsConnectionManager,
    @inject('config') private readonly config: Config
  ) {}

  /**
   * Get or create the publisher instance.
   * Lazy initialization to ensure NatsConnection is ready.
   */
  private getPublisher(): WallpaperUploadedPublisher {
    if (!this.publisher) {
      this.publisher = new WallpaperUploadedPublisher({
        natsConnection: this.natsClient.getClient(),
        serviceName: this.config.otelServiceName,
      });
    }
    return this.publisher;
  }

  /**
   * Publish wallpaper.uploaded event to NATS.
   *
   * The event is validated against the schema before publishing.
   * Trace context is automatically propagated via NATS headers.
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

    // Use the new publisher with full telemetry and validation
    await this.getPublisher().publishNew({
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
    });
  }
}
