import {
  BaseEventConsumer,
  WALLPAPER_VARIANT_AVAILABLE_SUBJECT,
  type WallpaperVariantAvailableEvent,
  WallpaperVariantAvailableEventSchema,
} from '@wallpaperdb/events';
import { inject, singleton } from 'tsyringe';
import { NatsConnectionManager } from '../connections/nats.js';
import { WallpaperRepository } from '../repositories/wallpaper.repository.js';

/**
 * Consumer for wallpaper.variant.available events
 * Adds variant information to existing wallpaper documents
 */
@singleton()
export class WallpaperVariantAvailableConsumer extends BaseEventConsumer<
  typeof WallpaperVariantAvailableEventSchema
> {
  protected readonly schema = WallpaperVariantAvailableEventSchema;
  protected readonly subject = WALLPAPER_VARIANT_AVAILABLE_SUBJECT;
  protected readonly eventType = 'wallpaper.variant.available' as const;

  constructor(
    @inject(NatsConnectionManager) natsConnectionManager: NatsConnectionManager,
    @inject(WallpaperRepository) private readonly wallpaperRepository: WallpaperRepository
  ) {
    super({
      natsConnectionProvider: () => natsConnectionManager.getConnection(),
      serviceName: 'gateway',
      streamName: 'WALLPAPER',
      durableName: 'gateway-wallpaper-variant-available',
      maxRetries: 3,
      ackWait: 30000, // 30 seconds
    });
  }

  public async handleEvent(event: WallpaperVariantAvailableEvent): Promise<void> {
    console.log('BEEP handleEventAvailable');

    // Add variant to wallpaper document
    await this.wallpaperRepository.addVariant(event.variant.wallpaperId, {
      width: event.variant.width,
      height: event.variant.height,
      aspectRatio: event.variant.aspectRatio,
      format: event.variant.format,
      fileSizeBytes: event.variant.fileSizeBytes,
      createdAt: event.variant.createdAt,
    });
  }
}
