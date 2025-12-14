import { Attributes, recordHistogram } from '@wallpaperdb/core/telemetry';
import {
  BaseEventConsumer,
  type EventConsumerConfig,
  type MessageContext,
} from '@wallpaperdb/events/consumer';
import {
  WALLPAPER_VARIANT_UPLOADED_SUBJECT,
  type WallpaperVariantUploadedEvent,
  WallpaperVariantUploadedEventSchema,
} from '@wallpaperdb/events/schemas';
import { NatsConnectionManager } from '../../connections/nats.js';
import { inject, injectable } from 'tsyringe';
import type { z } from 'zod';
import type { Config } from '../../config.js';
import { VariantRepository } from '../../repositories/variant.repository.js';
import { EventsService } from '../events.service.js';
import { WallpaperRepository } from '../../repositories/wallpaper.repository.js';
import { ulid } from 'ulid';

/**
 * Consumer for wallpaper.variant.uploaded events.
 * Listens to NATS JetStream and stores variant metadata in the local database.
 *
 * Published by the variant-generator service when a new variant has been
 * generated and uploaded to object storage.
 */
@injectable()
export class WallpaperVariantUploadedConsumerService extends BaseEventConsumer<
  typeof WallpaperVariantUploadedEventSchema
> {
  protected readonly schema = WallpaperVariantUploadedEventSchema;
  protected readonly subject = WALLPAPER_VARIANT_UPLOADED_SUBJECT;
  protected readonly eventType = 'wallpaper.variant.uploaded';

  constructor(
    @inject(EventsService) private readonly eventsService: EventsService,
    @inject(VariantRepository) private readonly variantRepository: VariantRepository,
    @inject(WallpaperRepository) private readonly wallpaperRepository: WallpaperRepository,
    @inject(NatsConnectionManager) natsConnection: NatsConnectionManager,
    @inject('config') config: Config
  ) {
    const consumerConfig: EventConsumerConfig = {
      natsConnectionProvider: () => natsConnection.getClient(),
      serviceName: config.otelServiceName,
      streamName: config.natsStream,
      durableName: 'media-wallpaper-variant-uploaded-consumer',
      maxRetries: 3,
      ackWait: 30000, // 30 seconds
    };
    super(consumerConfig);
  }

  async handleEvent(
    event: WallpaperVariantUploadedEvent,
    _context: MessageContext
  ): Promise<void> {
    console.log(
      `[WallpaperVariantUploadedConsumer] Processing event ${event.eventId} for wallpaper ${event.variant.wallpaperId}`
    );

    try {
      const startTime = Date.now();

      // Verify the parent wallpaper exists in our database
      const wallpaper = await this.wallpaperRepository.findById(event.variant.wallpaperId);
      if (!wallpaper) {
        console.warn(
          `[WallpaperVariantUploadedConsumer] Wallpaper ${event.variant.wallpaperId} not found, skipping variant`
        );
        return;
      }

      // Insert variant into database
      const variant = await this.variantRepository.insert({
        id: `var_${ulid()}`,
        wallpaperId: event.variant.wallpaperId,
        storageKey: event.variant.storageKey,
        width: event.variant.width,
        height: event.variant.height,
        fileSizeBytes: event.variant.fileSizeBytes,
        createdAt: new Date(event.variant.createdAt),
      });

      const durationMs = Date.now() - startTime;

      // Record business-specific metric
      recordHistogram('media.consumer.variant_insert_duration_ms', durationMs, {
        [Attributes.EVENT_TYPE]: 'wallpaper.variant.uploaded',
      });

      // Publish wallpaper.variant.available event
      await this.eventsService.publishUploadedEvent(wallpaper, variant);

      console.log(
        `[WallpaperVariantUploadedConsumer] Successfully processed variant ${variant.id} for wallpaper ${event.variant.wallpaperId}`
      );
    } catch (error) {
      console.error(
        `[WallpaperVariantUploadedConsumer] Failed to process event ${event.eventId}:`,
        error
      );
      throw error; // Re-throw for retry logic
    }
  }

  protected async onValidationError(
    error: z.ZodError,
    rawData: unknown,
    context: Partial<MessageContext>
  ): Promise<void> {
    console.error('[WallpaperVariantUploadedConsumer] Validation error:', {
      error: error.message,
      issues: error.issues,
      eventId: context.eventId,
      deliveryAttempt: context.deliveryAttempt,
      rawData,
    });
  }

  protected async onMaxRetriesExceeded(
    error: Error,
    event: WallpaperVariantUploadedEvent,
    context: MessageContext
  ): Promise<void> {
    console.error('[WallpaperVariantUploadedConsumer] Max retries exceeded:', {
      eventId: event.eventId,
      wallpaperId: event.variant.wallpaperId,
      error: error.message,
      attempts: context.deliveryAttempt,
    });
    // TODO: Send to DLQ or alerting system
  }
}
