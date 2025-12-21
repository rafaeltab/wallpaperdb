import { Attributes, recordCounter, recordHistogram, withSpan } from '@wallpaperdb/core/telemetry';
import {
  BaseEventConsumer,
  WALLPAPER_UPLOADED_SUBJECT,
  type WallpaperUploadedEvent,
  WallpaperUploadedEventSchema,
} from '@wallpaperdb/events';
import { inject, singleton } from 'tsyringe';
import { NatsConnectionManager } from '../connections/nats.js';
import { WallpaperRepository } from '../repositories/wallpaper.repository.js';

/**
 * Consumer for wallpaper.uploaded events
 * Creates initial wallpaper documents in OpenSearch (with empty variants array)
 */
@singleton()
export class WallpaperUploadedConsumer extends BaseEventConsumer<
  typeof WallpaperUploadedEventSchema
> {
  protected readonly schema = WallpaperUploadedEventSchema;
  protected readonly subject = WALLPAPER_UPLOADED_SUBJECT;
  protected readonly eventType = 'wallpaper.uploaded' as const;

  constructor(
    @inject(NatsConnectionManager) natsConnectionManager: NatsConnectionManager,
    @inject(WallpaperRepository) private readonly wallpaperRepository: WallpaperRepository
  ) {
    super({
      natsConnectionProvider: () => natsConnectionManager.getClient(),
      serviceName: 'gateway',
      streamName: 'WALLPAPER',
      durableName: 'gateway-wallpaper-uploaded',
      maxRetries: 3,
      ackWait: 30000, // 30 seconds
    });
  }

  public async handleEvent(event: WallpaperUploadedEvent): Promise<void> {
    return await withSpan(
      'gateway.consumer.handle_wallpaper_uploaded',
      {
        [Attributes.WALLPAPER_ID]: event.wallpaper.id,
        [Attributes.USER_ID]: event.wallpaper.userId,
        [Attributes.EVENT_ID]: event.eventId,
      },
      async () => {
        const startTime = Date.now();

        // Create wallpaper document with empty variants array
        await this.wallpaperRepository.upsert({
          wallpaperId: event.wallpaper.id,
          userId: event.wallpaper.userId,
          variants: [],
          uploadedAt: event.wallpaper.uploadedAt,
          updatedAt: new Date().toISOString(),
        });

        const durationMs = Date.now() - startTime;
        recordCounter('gateway.consumer.document_created.total', 1);
        recordHistogram('gateway.consumer.document_upsert_duration_ms', durationMs);
      }
    );
  }
}
