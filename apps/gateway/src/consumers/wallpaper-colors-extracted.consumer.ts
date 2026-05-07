import { Attributes, recordCounter, recordHistogram, withSpan } from '@wallpaperdb/core/telemetry';
import {
  BaseEventConsumer,
  WALLPAPER_COLORS_EXTRACTED_SUBJECT,
  type WallpaperColorsExtractedEvent,
  WallpaperColorsExtractedEventSchema,
} from '@wallpaperdb/events';
import { inject, singleton } from 'tsyringe';
import { NatsConnectionManager } from '../connections/nats.js';
import { WallpaperRepository } from '../repositories/wallpaper.repository.js';

/**
 * Consumer for wallpaper.colors.extracted events
 * Adds extracted color data to existing wallpaper documents
 */
@singleton()
export class WallpaperColorsExtractedConsumer extends BaseEventConsumer<
  typeof WallpaperColorsExtractedEventSchema
> {
  protected readonly schema = WallpaperColorsExtractedEventSchema;
  protected readonly subject = WALLPAPER_COLORS_EXTRACTED_SUBJECT;
  protected readonly eventType = 'wallpaper.colors.extracted' as const;

  constructor(
    @inject(NatsConnectionManager) natsConnectionManager: NatsConnectionManager,
    @inject(WallpaperRepository) private readonly wallpaperRepository: WallpaperRepository
  ) {
    super({
      natsConnectionProvider: () => natsConnectionManager.getClient(),
      serviceName: 'gateway',
      streamName: 'WALLPAPER',
      durableName: 'gateway-wallpaper-colors-extracted',
      maxRetries: 3,
      ackWait: 30000,
    });
  }

  public async handleEvent(event: WallpaperColorsExtractedEvent): Promise<void> {
    return await withSpan(
      'gateway.consumer.handle_wallpaper_colors_extracted',
      {
        [Attributes.WALLPAPER_ID]: event.wallpaperId,
        [Attributes.EVENT_ID]: event.eventId,
      },
      async () => {
        const startTime = Date.now();

        await this.wallpaperRepository.addColorData(event.wallpaperId, {
          colorHistogram: event.colorHistogram,
          colorSpace: event.colorSpace,
        });

        const durationMs = Date.now() - startTime;
        recordCounter('gateway.consumer.color_data_added.total', 1);
        recordHistogram('gateway.consumer.color_data_add_duration_ms', durationMs);
      }
    );
  }
}
