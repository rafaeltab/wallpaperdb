import { NatsConnectionManager } from '../connections/nats.js';
import { inject, injectable } from 'tsyringe';
import type { Config } from '../config.js';
import type { Variant, Wallpaper } from '../db/schema.js';
import { WallpaperVariantAvailablePublisher } from './publishers/wallpaper_variant_available.publisher.js';

// Re-export for backwards compatibility
export type { WallpaperUploadedEvent } from '@wallpaperdb/events/schemas';

/**
 * Service for publishing wallpaper-related events to NATS.
 *
 * Uses the new BaseEventPublisher infrastructure which provides:
 * - Zod schema validation before publishing
 * - OpenTelemetry trace context propagation
 * - Automatic telemetry spans and metrics
 */
@injectable()
export class EventsService {
  private publisher: WallpaperVariantAvailablePublisher | null = null;

  constructor(
    @inject(NatsConnectionManager) private readonly natsClient: NatsConnectionManager,
    @inject('config') private readonly config: Config
  ) {}

  /**
   * Get or create the publisher instance.
   * Lazy initialization to ensure NatsConnection is ready.
   */
  private getPublisher(): WallpaperVariantAvailablePublisher {
    if (!this.publisher) {
      this.publisher = new WallpaperVariantAvailablePublisher({
        natsConnection: this.natsClient.getClient(),
        serviceName: this.config.otelServiceName,
      });
    }
    return this.publisher;
  }

  /**
   * Publish wallpaper.variant.available event to NATS.
   *
   * The event is validated against the schema before publishing.
   * Trace context is automatically propagated via NATS headers.
   */
  async publishUploadedEvent(wallpaper: Wallpaper, variant?: Variant): Promise<void> {
    const dataSource = variant ?? wallpaper;

    if (
      !dataSource.fileSizeBytes ||
      !dataSource.width ||
      !dataSource.height ||
      !dataSource.createdAt ||
      !wallpaper.mimeType ||
      !wallpaper.id ||
      !isStringUnion(wallpaper.mimeType, ['image/jpeg', 'image/png', 'image/webp'])
    ) {
      throw new Error('Wallpaper data incomplete for event publishing');
    }

    // Use the new publisher with full telemetry and validation
    await this.getPublisher().publishNew({
      variant: {
        fileSizeBytes: dataSource.fileSizeBytes,
        aspectRatio: dataSource.width / dataSource.height,
        height: dataSource.height,
        width: dataSource.width,
        createdAt: dataSource.createdAt.toISOString(),
        format: wallpaper.mimeType as 'image/jpeg' | 'image/png' | 'image/webp',
        wallpaperId: wallpaper.id,
      },
    });
  }
}

function isStringUnion(str: string, allowed: string[]) {
  return allowed.includes(str);
}
