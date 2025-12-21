import { Attributes, recordCounter, recordHistogram, withSpan } from '@wallpaperdb/core/telemetry';
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
      natsConnectionProvider: () => natsConnectionManager.getClient(),
      serviceName: 'gateway',
      streamName: 'WALLPAPER',
      durableName: 'gateway-wallpaper-variant-available',
      maxRetries: 3,
      ackWait: 30000, // 30 seconds
    });
  }

  public async handleEvent(event: WallpaperVariantAvailableEvent): Promise<void> {
    return await withSpan(
      'gateway.consumer.handle_wallpaper_variant_available',
      {
        [Attributes.WALLPAPER_ID]: event.variant.wallpaperId,
        [Attributes.EVENT_ID]: event.eventId,
        [Attributes.IMAGE_FORMAT]: event.variant.format,
        [Attributes.FILE_WIDTH]: event.variant.width,
        [Attributes.FILE_HEIGHT]: event.variant.height,
      },
      async () => {
        const startTime = Date.now();

        // Add variant to wallpaper document
        await this.wallpaperRepository.addVariant(event.variant.wallpaperId, {
          width: event.variant.width,
          height: event.variant.height,
          aspectRatio: event.variant.aspectRatio,
          format: event.variant.format,
          fileSizeBytes: event.variant.fileSizeBytes,
          createdAt: event.variant.createdAt,
        });

        const durationMs = Date.now() - startTime;
        recordCounter('gateway.consumer.variant_added.total', 1);
        recordHistogram('gateway.consumer.variant_add_duration_ms', durationMs);
      }
    );
  }
}
