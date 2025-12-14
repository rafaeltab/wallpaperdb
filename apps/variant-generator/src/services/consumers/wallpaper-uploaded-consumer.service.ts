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
import { VariantGeneratorService } from '../variant-generator.service.js';

/**
 * Consumer for wallpaper.uploaded events.
 * Listens to NATS JetStream and generates variants for uploaded wallpapers.
 *
 * Design decisions:
 * - Longer ack wait (120s) for heavy image processing
 * - Filters to images only (skips videos)
 * - Continues generating remaining variants even if one fails
 */
@injectable()
export class WallpaperUploadedConsumerService extends BaseEventConsumer<
  typeof WallpaperUploadedEventSchema
> {
  protected readonly schema = WallpaperUploadedEventSchema;
  protected readonly subject = WALLPAPER_UPLOADED_SUBJECT;
  protected readonly eventType = 'wallpaper.uploaded';

  constructor(
    @inject(VariantGeneratorService) private readonly variantGenerator: VariantGeneratorService,
    @inject(NatsConnectionManager) natsConnection: NatsConnectionManager,
    @inject('config') config: Config
  ) {
    const consumerConfig: EventConsumerConfig = {
      natsConnectionProvider: () => natsConnection.getClient(),
      serviceName: config.otelServiceName,
      streamName: config.natsStream,
      durableName: 'variant-generator-wallpaper-uploaded-consumer',
      maxRetries: 3,
      ackWait: 120000, // 120 seconds for heavy image processing
    };
    super(consumerConfig);
  }

  async handleEvent(event: WallpaperUploadedEvent, _context: MessageContext): Promise<void> {
    console.log(
      `[WallpaperUploadedConsumer] Processing event ${event.eventId} for wallpaper ${event.wallpaper.id}`
    );

    // Skip non-image files
    if (event.wallpaper.fileType !== 'image') {
      console.log(
        `[WallpaperUploadedConsumer] Skipping non-image file ${event.wallpaper.id} (type: ${event.wallpaper.fileType})`
      );
      return;
    }

    try {
      const startTime = Date.now();

      // Generate all applicable variants
      const variants = await this.variantGenerator.generateVariants(event.wallpaper);

      const durationMs = Date.now() - startTime;

      // Record business-specific metric
      recordHistogram('variant_generator.consumer.process_duration_ms', durationMs, {
        [Attributes.EVENT_TYPE]: 'wallpaper.uploaded',
        variants_generated: variants.length.toString(),
      });

      console.log(
        `[WallpaperUploadedConsumer] Successfully generated ${variants.length} variants for wallpaper ${event.wallpaper.id} in ${durationMs}ms`
      );
    } catch (error) {
      console.error(
        `[WallpaperUploadedConsumer] Failed to process event ${event.eventId}:`,
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
