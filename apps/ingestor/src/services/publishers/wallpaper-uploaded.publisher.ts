import {
  WallpaperUploadedEventSchema,
  WALLPAPER_UPLOADED_SUBJECT,
  type WallpaperUploadedEvent,
} from '@wallpaperdb/events/schemas';
import { BaseEventPublisher } from '@wallpaperdb/events/publisher';

/**
 * Publisher for wallpaper.uploaded events.
 *
 * Extends BaseEventPublisher to provide:
 * - Zod schema validation before publishing
 * - OpenTelemetry trace context propagation
 * - Automatic telemetry spans and metrics
 *
 * @example
 * ```typescript
 * const publisher = new WallpaperUploadedPublisher({
 *   natsConnection,
 *   serviceName: 'ingestor',
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
export class WallpaperUploadedPublisher extends BaseEventPublisher<typeof WallpaperUploadedEventSchema> {
  protected readonly schema = WallpaperUploadedEventSchema;
  protected readonly subject = WALLPAPER_UPLOADED_SUBJECT;
  protected readonly eventType = 'wallpaper.uploaded';
}

export type { WallpaperUploadedEvent };
