import {
  BaseEventConsumer,
  type EventConsumerConfig,
  type MessageContext,
} from '@wallpaperdb/events/consumer';
import {
  WallpaperUploadedEventSchema,
  WALLPAPER_UPLOADED_SUBJECT,
  type WallpaperUploadedEvent,
} from '@wallpaperdb/events/schemas';
import { recordHistogram, Attributes } from '@wallpaperdb/core/telemetry';
import { inject, injectable } from 'tsyringe';
import type { z } from 'zod';
import type { Config } from '../../config.js';
import { NatsConnectionManager } from '../../connections/nats.js';
import { WallpaperRepository } from '../../repositories/wallpaper.repository.js';

/**
 * Consumer for wallpaper.uploaded events.
 * Listens to NATS JetStream and stores wallpaper metadata in the local database.
 */
@injectable()
export class WallpaperUploadedConsumerService extends BaseEventConsumer<
  typeof WallpaperUploadedEventSchema
> {
  protected readonly schema = WallpaperUploadedEventSchema;
  protected readonly subject = WALLPAPER_UPLOADED_SUBJECT;
  protected readonly eventType = 'wallpaper.uploaded';

  constructor(
    @inject(WallpaperRepository) private readonly repository: WallpaperRepository,
    @inject(NatsConnectionManager) natsConnection: NatsConnectionManager,
    @inject('config') config: Config
  ) {
    const consumerConfig: EventConsumerConfig = {
      natsConnection: natsConnection.getClient(),
      serviceName: config.otelServiceName,
      streamName: config.natsStream,
      durableName: 'media-wallpaper-uploaded-consumer',
      maxRetries: 3,
      ackWait: 30000, // 30 seconds
    };
    super(consumerConfig);
  }

  async handleEvent(event: WallpaperUploadedEvent, _context: MessageContext): Promise<void> {
    console.log(
      `[WallpaperUploadedConsumer] Processing event ${event.eventId} for wallpaper ${event.wallpaper.id}`
    );

    try {
      const startTime = Date.now();

      await this.repository.upsert({
        id: event.wallpaper.id,
        storageBucket: event.wallpaper.storageBucket,
        storageKey: event.wallpaper.storageKey,
        mimeType: event.wallpaper.mimeType,
        width: event.wallpaper.width,
        height: event.wallpaper.height,
        fileSizeBytes: event.wallpaper.fileSizeBytes,
      });

      const durationMs = Date.now() - startTime;

      // Record business-specific metric (repository upsert already has db metrics)
      recordHistogram('media.consumer.upsert_duration_ms', durationMs, {
        [Attributes.EVENT_TYPE]: 'wallpaper.uploaded',
      });

      console.log(
        `[WallpaperUploadedConsumer] Successfully processed wallpaper ${event.wallpaper.id}`
      );
    } catch (error) {
      console.error(`[WallpaperUploadedConsumer] Failed to process event ${event.eventId}:`, error);
      throw error; // Re-throw for retry logic
    }
  }

  protected async onValidationError(
    error: z.ZodError,
    rawData: unknown,
    context: Partial<MessageContext>
  ): Promise<void> {
    console.error('[WallpaperUploadedConsumer] Validation error:', {
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
    console.error('[WallpaperUploadedConsumer] Max retries exceeded:', {
      eventId: event.eventId,
      wallpaperId: event.wallpaper.id,
      error: error.message,
      attempts: context.deliveryAttempt,
    });
    // TODO: Send to DLQ or alerting system
  }
}
