import { Attributes, recordHistogram } from '@wallpaperdb/core/telemetry';
import {
  BaseEventConsumer,
  type EventConsumerConfig,
  type MessageContext,
} from '@wallpaperdb/events/consumer';
import {
  WALLPAPER_UPLOADED_SUBJECT,
  type WallpaperUploadedEvent,
  WallpaperUploadedEventSchema,
} from '@wallpaperdb/events/schemas';
import { NatsConnectionManager } from '../../connections/nats.js';
import { inject, injectable } from 'tsyringe';
import type { z } from 'zod';
import type { Config } from '../../config.js';
import { ColorExtractionProcessor } from '../color-extraction-processor.js';

@injectable()
export class WallpaperUploadedConsumerService extends BaseEventConsumer<
  typeof WallpaperUploadedEventSchema
> {
  protected readonly schema = WallpaperUploadedEventSchema;
  protected readonly subject = WALLPAPER_UPLOADED_SUBJECT;
  protected readonly eventType = 'wallpaper.uploaded';

  constructor(
    @inject(ColorExtractionProcessor) private readonly processor: ColorExtractionProcessor,
    @inject(NatsConnectionManager) natsConnection: NatsConnectionManager,
    @inject('config') config: Config
  ) {
    const consumerConfig: EventConsumerConfig = {
      natsConnectionProvider: () => natsConnection.getClient(),
      serviceName: config.otelServiceName,
      streamName: config.natsStream,
      durableName: 'color-extractor-wallpaper-uploaded-consumer',
      maxRetries: 3,
      ackWait: 120000,
    };
    super(consumerConfig);
  }

  async handleEvent(event: WallpaperUploadedEvent, _context: MessageContext): Promise<void> {
    console.log(
      `[ColorExtractorConsumer] Processing event ${event.eventId} for wallpaper ${event.wallpaper.id}`
    );

    if (event.wallpaper.fileType !== 'image') {
      console.log(
        `[ColorExtractorConsumer] Skipping non-image file ${event.wallpaper.id} (type: ${event.wallpaper.fileType})`
      );
      return;
    }

    try {
      const startTime = Date.now();

      await this.processor.extractColors(event.wallpaper);

      const durationMs = Date.now() - startTime;

      recordHistogram('color_extractor.consumer.process_duration_ms', durationMs, {
        [Attributes.EVENT_TYPE]: 'wallpaper.uploaded',
      });

      console.log(
        `[ColorExtractorConsumer] Successfully extracted colors for wallpaper ${event.wallpaper.id} in ${durationMs}ms`
      );
    } catch (error) {
      console.error(`[ColorExtractorConsumer] Failed to process event ${event.eventId}:`, error);
      throw error;
    }
  }

  protected async onValidationError(
    error: z.ZodError,
    rawData: unknown,
    context: Partial<MessageContext>
  ): Promise<void> {
    console.error('[ColorExtractorConsumer] Validation error:', {
      error: error.message,
      issues: error.issues,
      eventId: context.eventId,
      deliveryAttempt: context.deliveryAttempt,
      rawData,
    });
  }

  protected async onMaxRetriesExceeded(
    error: Error,
    event: WallpaperUploadedEvent,
    context: MessageContext
  ): Promise<void> {
    console.error('[ColorExtractorConsumer] Max retries exceeded:', {
      eventId: event.eventId,
      wallpaperId: event.wallpaper.id,
      error: error.message,
      attempts: context.deliveryAttempt,
    });
  }
}
