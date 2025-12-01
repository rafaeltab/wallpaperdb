import { BaseEventPublisher } from '@wallpaperdb/events/publisher';
import {
  WALLPAPER_VARIANT_AVAILABLE_SUBJECT,
  type WallpaperVariantAvailableEvent,
  WallpaperVariantAvailableEventSchema,
} from '@wallpaperdb/events/schemas';

/**
 * Publisher for wallpaper.variant.available events.
 *
 * Extends BaseEventPublisher to provide:
 * - Zod schema validation before publishing
 * - OpenTelemetry trace context propagation
 * - Automatic telemetry spans and metrics
 *
 * @example
 * ```typescript
 * const publisher = new WallpaperVariantAvailablePublisher({
 *   natsConnection,
 *   serviceName: 'media',
 * });
 *
 * await publisher.publishNew({
 *   wallpaper: {
 *     id: 'wlpr_123',
 *     userId: 'user_456',
 *     // ... other fields
 *   },
 * });
 * ```
 */
export class WallpaperVariantAvailablePublisher extends BaseEventPublisher<
  typeof WallpaperVariantAvailableEventSchema
> {
  protected readonly schema = WallpaperVariantAvailableEventSchema;
  protected readonly subject = WALLPAPER_VARIANT_AVAILABLE_SUBJECT;
  protected readonly eventType = 'wallpaper.variant.available';
}

export type { WallpaperVariantAvailableEvent };
