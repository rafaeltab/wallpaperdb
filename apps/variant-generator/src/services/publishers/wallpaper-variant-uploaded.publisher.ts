import { BaseEventPublisher } from '@wallpaperdb/events/publisher';
import {
  WALLPAPER_VARIANT_UPLOADED_SUBJECT,
  type WallpaperVariantUploadedEvent,
  WallpaperVariantUploadedEventSchema,
} from '@wallpaperdb/events/schemas';

/**
 * Publisher for wallpaper.variant.uploaded events.
 *
 * Extends BaseEventPublisher to provide:
 * - Zod schema validation before publishing
 * - OpenTelemetry trace context propagation
 * - Automatic telemetry spans and metrics
 *
 * @example
 * ```typescript
 * const publisher = new WallpaperVariantUploadedPublisher({
 *   natsConnection,
 *   serviceName: 'variant-generator',
 * });
 *
 * await publisher.publishNew({
 *   variant: {
 *     wallpaperId: 'wlpr_123',
 *     width: 1920,
 *     height: 1080,
 *     aspectRatio: 1.777,
 *     format: 'image/jpeg',
 *     fileSizeBytes: 123456,
 *     storageKey: 'wlpr_123/variant_1920x1080.jpg',
 *     storageBucket: 'wallpapers',
 *     createdAt: '2025-01-01T00:00:00Z',
 *   },
 * });
 * ```
 */
export class WallpaperVariantUploadedPublisher extends BaseEventPublisher<
  typeof WallpaperVariantUploadedEventSchema
> {
  protected readonly schema = WallpaperVariantUploadedEventSchema;
  protected readonly subject = WALLPAPER_VARIANT_UPLOADED_SUBJECT;
  protected readonly eventType = 'wallpaper.variant.uploaded';
}

export type { WallpaperVariantUploadedEvent };
