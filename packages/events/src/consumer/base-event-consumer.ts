import { context, propagation } from "@opentelemetry/api";
import { Attributes, recordCounter, recordHistogram, withSpan } from "@wallpaperdb/core/telemetry";
import type { Consumer, ConsumerMessages, JetStreamClient, JsMsg, NatsConnection } from "nats";
import { AckPolicy } from "nats";
import type { z } from "zod";

/**
 * Configuration for event consumer.
 */
export interface EventConsumerConfig {
  /** NATS connection to use for consuming */
  natsConnectionProvider: () => NatsConnection;
  /** Name of the service consuming events (used for telemetry) */
  serviceName: string;
  /** Name of the JetStream stream to consume from */
  streamName: string;
  /** Durable consumer name (optional, for persistent consumers) */
  durableName?: string;
  /** Maximum number of retry attempts before giving up (default: 3) */
  maxRetries?: number;
  /** Time to wait for acknowledgment in milliseconds (default: 30000) */
  ackWait?: number;
}

/**
 * Context passed to event handlers with metadata about the message.
 */
export interface MessageContext {
  /** Unique event identifier from the event payload */
  eventId: string;
  /** ISO 8601 timestamp from the event payload */
  timestamp: string;
  /** Headers from the NATS message */
  headers: Record<string, string | undefined>;
  /** Number of times this message has been delivered */
  deliveryAttempt: number;
  /** Name of the stream */
  stream: string;
  /** Name of the consumer */
  consumer: string;
}

/**
 * Base class for consuming events from NATS JetStream.
 *
 * Provides:
 * - Zod schema validation on incoming messages
 * - OpenTelemetry trace context extraction
 * - Automatic span creation and metrics recording
 * - Configurable retry behavior
 * - Graceful shutdown handling
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
 * class WallpaperUploadedConsumer extends BaseEventConsumer<typeof WallpaperUploadedEventSchema> {
 *   protected readonly schema = WallpaperUploadedEventSchema;
 *   protected readonly subject = "wallpaper.uploaded";
 *   protected readonly eventType = "wallpaper.uploaded";
 *
 *   async handleEvent(event: WallpaperUploadedEvent, context: MessageContext) {
 *     // Process the event
 *     console.log(`Processing wallpaper ${event.wallpaper.id}`);
 *   }
 * }
 *
 * const consumer = new WallpaperUploadedConsumer({
 *   natsConnection,
 *   serviceName: "thumbnail-extractor",
 *   streamName: "wallpapers",
 *   durableName: "thumbnail-extractor",
 * });
 * await consumer.start();
 * ```
 */
export abstract class BaseEventConsumer<TSchema extends z.ZodType> {
  protected readonly jsProvider: () => JetStreamClient;
  protected readonly serviceName: string;
  protected readonly streamName: string;
  protected readonly durableName?: string;
  protected readonly maxRetries: number;
  protected readonly ackWait: number;
  protected readonly natsConnectionProvider: () => NatsConnection;

  private running = false;
  private consumer: Consumer | null = null;
  private consumerMessages: ConsumerMessages | null = null;
  private processingPromise: Promise<void> | null = null;

  /** Zod schema for validating events */
  protected abstract readonly schema: TSchema;
  /** NATS subject filter (can include wildcards) */
  protected abstract readonly subject: string;
  /** Event type identifier */
  protected abstract readonly eventType: string;

  constructor(config: EventConsumerConfig) {
    this.natsConnectionProvider = config.natsConnectionProvider;
    this.jsProvider = () => config.natsConnectionProvider().jetstream();
    this.serviceName = config.serviceName;
    this.streamName = config.streamName;
    this.durableName = config.durableName;
    this.maxRetries = config.maxRetries ?? 3;
    this.ackWait = config.ackWait ?? 30000;
  }

  /**
   * Handle an incoming event. Implement this in your consumer.
   *
   * @param event - The validated event payload
   * @param context - Message metadata and context
   */
  abstract handleEvent(event: z.infer<TSchema>, context: MessageContext): Promise<void>;

  /**
   * Called when an event fails schema validation.
   * Override to implement custom error handling (e.g., send to DLQ).
   * By default, logs the error.
   *
   * @param error - The Zod validation error
   * @param rawData - The raw message data that failed validation
   * @param context - Message metadata
   */
  protected async onValidationError(
    _error: z.ZodError,
    _rawData: unknown,
    _context: Partial<MessageContext>
  ): Promise<void> {
    // Default: do nothing, subclasses can override
  }

  /**
   * Called when an event fails processing after max retries.
   * Override to implement custom error handling (e.g., send to DLQ).
   *
   * @param error - The error that caused the failure
   * @param event - The validated event that failed processing
   * @param context - Message metadata
   */
  protected async onMaxRetriesExceeded(
    _error: Error,
    _event: z.infer<TSchema>,
    _context: MessageContext
  ): Promise<void> {
    // Default: do nothing, subclasses can override
  }

  /**
   * Start consuming messages.
   * This method will continue running until stop() is called.
   */
  async start(): Promise<void> {
    if (this.running) {
      throw new Error("Consumer is already running");
    }

    this.running = true;

    const js = this.jsProvider();
    const natsConnection = this.natsConnectionProvider();

    // Get or create consumer
    const consumers = js.consumers;

    if (this.durableName) {
      // Use JetStreamManager to create or get durable consumer
      const jsm = await natsConnection.jetstreamManager();

      try {
        // Try to get existing consumer
        await jsm.consumers.info(this.streamName, this.durableName);
        this.consumer = await consumers.get(this.streamName, this.durableName);
      } catch (_error) {
        // Consumer doesn't exist, create it
        await jsm.consumers.add(this.streamName, {
          durable_name: this.durableName,
          ack_policy: AckPolicy.Explicit,
          ack_wait: this.ackWait * 1_000_000, // Convert ms to nanoseconds
          max_deliver: this.maxRetries + 1, // Initial delivery + retries
          filter_subject: this.subject,
        });
        this.consumer = await consumers.get(this.streamName, this.durableName);
      }
    } else {
      // Use ordered consumer (ephemeral)
      this.consumer = await consumers.get(this.streamName);
    }

    // Start consuming
    this.consumerMessages = await this.consumer.consume();

    // Process messages (don't await - let it run in background)
    this.processingPromise = this.processMessages();
  }

  /**
   * Stop consuming messages gracefully.
   * Waits for current message processing to complete.
   */
  async stop(): Promise<void> {
    this.running = false;

    if (this.consumerMessages) {
      this.consumerMessages.stop();
    }

    if (this.processingPromise) {
      await this.processingPromise;
    }

    this.consumer = null;
    this.consumerMessages = null;
    this.processingPromise = null;
  }

  /**
   * Check if the consumer is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }

  private async processMessages(): Promise<void> {
    if (!this.consumerMessages) return;

    try {
      for await (const msg of this.consumerMessages) {
        if (!this.running) break;

        await this.processMessage(msg);
      }
    } catch (error) {
      // Consumer was stopped or connection lost
      if (this.running) {
        // Unexpected error - log and stop
        console.error("Consumer error:", error);
        this.running = false;
      }
    }
  }

  /**
   * Process a single message. Exposed as protected for testing.
   * @internal
   */
  protected async processMessage(msg: JsMsg): Promise<void> {
    const startTime = Date.now();
    let rawData: unknown;

    // Extract headers for trace context
    const headerCarrier: Record<string, string | undefined> = {};
    if (msg.headers) {
      for (const key of msg.headers.keys()) {
        headerCarrier[key] = msg.headers.get(key);
      }
    }

    // Extract trace context from headers
    const extractedContext = propagation.extract(context.active(), headerCarrier);

    // Get message info
    const messageInfo = msg.info;
    const deliveryAttempt = messageInfo?.redeliveryCount ?? 0;
    const stream = messageInfo?.stream ?? this.streamName;
    const consumerName = messageInfo?.consumer ?? this.durableName ?? "unknown";

    // Parse message data
    try {
      const decoder = new TextDecoder();
      rawData = JSON.parse(decoder.decode(msg.data));
    } catch (error) {
      // Invalid JSON - terminate (won't succeed on retry)
      recordCounter("events.consumed.total", 1, {
        [Attributes.EVENT_TYPE]: this.eventType,
        status: "parse_error",
      });
      msg.term();
      console.error(error);
      return;
    }

    // Build partial context (before validation)
    const partialContext: Partial<MessageContext> = {
      headers: headerCarrier,
      deliveryAttempt,
      stream,
      consumer: consumerName,
    };

    // Validate against schema
    const result = this.schema.safeParse(rawData);
    if (!result.success) {
      recordCounter("events.consumed.total", 1, {
        [Attributes.EVENT_TYPE]: this.eventType,
        status: "validation_error",
      });

      await this.onValidationError(result.error, rawData, partialContext);

      // Validation errors won't succeed on retry - terminate
      msg.term();
      return;
    }

    const event = result.data;
    const messageContext: MessageContext = {
      eventId: event.eventId ?? "unknown",
      timestamp: event.timestamp ?? new Date().toISOString(),
      headers: headerCarrier,
      deliveryAttempt,
      stream,
      consumer: consumerName,
    };

    // Process within trace context
    await context.with(extractedContext, async () => {
      await withSpan(
        "events.consume",
        {
          [Attributes.EVENT_TYPE]: this.eventType,
          [Attributes.EVENT_SUBJECT]: this.subject,
          [Attributes.EVENT_ID]: messageContext.eventId,
          [Attributes.EVENT_STREAM]: stream,
          [Attributes.EVENT_CONSUMER]: consumerName,
          [Attributes.EVENT_DELIVERY_ATTEMPT]: deliveryAttempt,
          "service.name": this.serviceName,
        },
        async (span) => {
          try {
            await this.handleEvent(event, messageContext);

            // Success - acknowledge
            msg.ack();

            const duration = Date.now() - startTime;
            recordCounter("events.consumed.total", 1, {
              [Attributes.EVENT_TYPE]: this.eventType,
              status: "success",
            });
            recordHistogram("events.consume_duration_ms", duration, {
              [Attributes.EVENT_TYPE]: this.eventType,
            });

            span.setAttribute("events.consume.success", true);
          } catch (error) {
            const duration = Date.now() - startTime;
            recordCounter("events.consumed.total", 1, {
              [Attributes.EVENT_TYPE]: this.eventType,
              status: "error",
            });
            recordHistogram("events.consume_duration_ms", duration, {
              [Attributes.EVENT_TYPE]: this.eventType,
            });

            span.setAttribute("events.consume.success", false);

            // Check if max retries exceeded
            if (deliveryAttempt >= this.maxRetries) {
              await this.onMaxRetriesExceeded(
                error instanceof Error ? error : new Error(String(error)),
                event,
                messageContext
              );
              // Terminate after max retries
              msg.term();
            } else {
              // Negative acknowledge for retry
              msg.nak();
            }
          }
        }
      );
    });
  }
}
