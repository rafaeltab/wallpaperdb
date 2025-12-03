import {
  BaseEventConsumer,
  WALLPAPER_UPLOADED_SUBJECT,
  type WallpaperUploadedEvent,
  WallpaperUploadedEventSchema,
} from '@wallpaperdb/events';
import { NatsConnectionManager } from '../connections/nats.js';
import { inject, singleton } from 'tsyringe';
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
    console.log('BEEP handleEventUploaded');
    // Create wallpaper document with empty variants array
    await this.wallpaperRepository.upsert({
      wallpaperId: event.wallpaper.id,
      userId: event.wallpaper.userId,
      variants: [],
      uploadedAt: event.wallpaper.uploadedAt,
      updatedAt: new Date().toISOString(),
    });
  }
}
