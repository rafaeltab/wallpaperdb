import type { NatsConnection, JetStreamClient } from "nats";
import { headers as natsHeaders } from "nats";
import type { z } from "zod";
import { propagation, context } from "@opentelemetry/api";
import { ulid } from "ulid";
import { withSpan, recordCounter, recordHistogram, Attributes } from "@wallpaperdb/core/telemetry";

/**
 * Configuration for event publisher.
 */
export interface EventPublisherConfig {
  /** NATS connection to use for publishing */
  natsConnection: NatsConnection;
  /** Name of the service publishing events (used for telemetry) */
  serviceName: string;
}

/**
 * Options for publishing an event.
 */
export interface PublishOptions {
  /** Additional headers to include with the message */
  headers?: Record<string, string>;
}

/**
 * Error thrown when event validation fails before publishing.
 */
export class EventValidationError extends Error {
  constructor(
    message: string,
    public readonly zodError: z.ZodError
  ) {
    super(message);
    this.name = "EventValidationError";
  }
}

/**
 * Base class for publishing events to NATS JetStream.
 *
 * Provides:
 * - Zod schema validation before publishing
 * - OpenTelemetry trace context propagation
 * - Automatic span creation and metrics recording
 * - Event envelope creation with auto-generated eventId and timestamp
 *
 * @example
 * ```typescript
 * const WallpaperUploadedEventSchema = z.object({
 *   eventId: z.string(),
 *   eventType: z.literal("wallpaper.uploaded"),
 *   timestamp: z.string().datetime(),
 *   wallpaper: z.object({ ... }),
 * });
 *
 * class WallpaperEventPublisher extends BaseEventPublisher<typeof WallpaperUploadedEventSchema> {
 *   protected readonly schema = WallpaperUploadedEventSchema;
 *   protected readonly subject = "wallpaper.uploaded";
 *   protected readonly eventType = "wallpaper.uploaded";
 * }
 *
 * const publisher = new WallpaperEventPublisher({ natsConnection, serviceName: "ingestor" });
 * await publisher.publishNew({ wallpaper: { ... } });
 * ```
 */
export abstract class BaseEventPublisher<TSchema extends z.ZodType> {
  protected readonly js: JetStreamClient;
  protected readonly serviceName: string;

  /** Zod schema for validating events */
  protected abstract readonly schema: TSchema;
  /** NATS subject to publish to */
  protected abstract readonly subject: string;
  /** Event type identifier */
  protected abstract readonly eventType: string;

  constructor(config: EventPublisherConfig) {
    this.js = config.natsConnection.jetstream();
    this.serviceName = config.serviceName;
  }

  /**
   * Publish a fully-formed event (must include eventId, eventType, timestamp).
   * Validates the event against the schema before publishing.
   *
   * @param event - The complete event to publish
   * @param options - Optional publish options
   * @throws EventValidationError if the event fails schema validation
   */
  async publish(event: z.infer<TSchema>, options?: PublishOptions): Promise<void> {
    // Validate event against schema
    const result = this.schema.safeParse(event);
    if (!result.success) {
      throw new EventValidationError(
        `Event validation failed: ${result.error.message}`,
        result.error
      );
    }

    await withSpan(
      "events.publish",
      {
        [Attributes.EVENT_TYPE]: this.eventType,
        [Attributes.EVENT_SUBJECT]: this.subject,
        "service.name": this.serviceName,
      },
      async (span) => {
        const startTime = Date.now();

        try {
          // Create NATS headers and inject trace context
          const hdrs = natsHeaders();

          // Inject OpenTelemetry trace context
          const carrier: Record<string, string> = {};
          propagation.inject(context.active(), carrier);
          for (const [key, value] of Object.entries(carrier)) {
            hdrs.set(key, value);
          }

          // Add custom headers
          if (options?.headers) {
            for (const [key, value] of Object.entries(options.headers)) {
              hdrs.set(key, value);
            }
          }

          // Add event metadata to headers
          const validatedEvent = result.data;
          if (validatedEvent.eventId) {
            hdrs.set("event-id", validatedEvent.eventId);
            span.setAttribute(Attributes.EVENT_ID, validatedEvent.eventId);
          }

          // Serialize and publish
          const data = JSON.stringify(validatedEvent);
          const encoder = new TextEncoder();

          await this.js.publish(this.subject, encoder.encode(data), { headers: hdrs });

          // Record success metrics
          const duration = Date.now() - startTime;
          recordCounter("events.published.total", 1, {
            [Attributes.EVENT_TYPE]: this.eventType,
            status: "success",
          });
          recordHistogram("events.publish_duration_ms", duration, {
            [Attributes.EVENT_TYPE]: this.eventType,
          });

          span.setAttribute("events.publish.success", true);
        } catch (error) {
          // Record failure metrics
          const duration = Date.now() - startTime;
          recordCounter("events.published.total", 1, {
            [Attributes.EVENT_TYPE]: this.eventType,
            status: "error",
          });
          recordHistogram("events.publish_duration_ms", duration, {
            [Attributes.EVENT_TYPE]: this.eventType,
          });

          span.setAttribute("events.publish.success", false);
          throw error;
        }
      }
    );
  }

  /**
   * Create a complete event from a partial payload.
   * Automatically generates eventId, eventType, and timestamp if not provided.
   *
   * @param partial - Partial event data (payload fields)
   * @returns Complete event ready for publishing
   */
  createEvent(partial: Partial<z.infer<TSchema>>): z.infer<TSchema> {
    return {
      eventId: ulid(),
      eventType: this.eventType,
      timestamp: new Date().toISOString(),
      ...partial,
    } as z.infer<TSchema>;
  }

  /**
   * Create and publish an event in one step.
   * Convenience method that combines createEvent and publish.
   *
   * @param partial - Partial event data (payload fields)
   * @param options - Optional publish options
   */
  async publishNew(
    partial: Omit<z.infer<TSchema>, "eventId" | "eventType" | "timestamp"> &
      Partial<Pick<z.infer<TSchema>, "eventId" | "eventType" | "timestamp">>,
    options?: PublishOptions
  ): Promise<void> {
    const event = this.createEvent(partial);
    await this.publish(event, options);
  }
}
