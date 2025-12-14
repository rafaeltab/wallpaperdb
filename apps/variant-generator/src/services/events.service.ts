import { NatsConnectionManager } from '../connections/nats.js';
import { inject, injectable } from 'tsyringe';
import type { Config } from '../config.js';
import { WallpaperVariantUploadedPublisher } from './publishers/wallpaper-variant-uploaded.publisher.js';

/**
 * Generated variant metadata
 */
export interface GeneratedVariant {
  wallpaperId: string;
  width: number;
  height: number;
  aspectRatio: number;
  format: 'image/jpeg' | 'image/png' | 'image/webp';
  fileSizeBytes: number;
  storageKey: string;
  storageBucket: string;
  createdAt: Date;
}

/**
 * Service for publishing variant-related events to NATS.
 *
 * Uses the BaseEventPublisher infrastructure which provides:
 * - Zod schema validation before publishing
 * - OpenTelemetry trace context propagation
 * - Automatic telemetry spans and metrics
 */
@injectable()
export class EventsService {
  private publisher: WallpaperVariantUploadedPublisher | null = null;

  constructor(
    @inject(NatsConnectionManager) private readonly natsClient: NatsConnectionManager,
    @inject('config') private readonly config: Config
  ) {}

  /**
   * Get or create the publisher instance.
   * Lazy initialization to ensure NatsConnection is ready.
   */
  private getPublisher(): WallpaperVariantUploadedPublisher {
    if (!this.publisher) {
      this.publisher = new WallpaperVariantUploadedPublisher({
        natsConnection: this.natsClient.getClient(),
        serviceName: this.config.otelServiceName,
      });
    }
    return this.publisher;
  }

  /**
   * Publish wallpaper.variant.uploaded event to NATS.
   *
   * The event is validated against the schema before publishing.
   * Trace context is automatically propagated via NATS headers.
   */
  async publishVariantUploaded(variant: GeneratedVariant): Promise<void> {
    await this.getPublisher().publishNew({
      variant: {
        wallpaperId: variant.wallpaperId,
        width: variant.width,
        height: variant.height,
        aspectRatio: variant.aspectRatio,
        format: variant.format,
        fileSizeBytes: variant.fileSizeBytes,
        storageKey: variant.storageKey,
        storageBucket: variant.storageBucket,
        createdAt: variant.createdAt.toISOString(),
      },
    });
  }
}
