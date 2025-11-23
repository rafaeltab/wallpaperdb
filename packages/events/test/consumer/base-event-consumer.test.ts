import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type {
  NatsConnection,
  JetStreamClient,
  JsMsg,
  Consumer,
  Consumers,
  JetStreamManager,
  StreamInfo,
  ConsumerInfo,
} from "nats";
import { BaseEventConsumer } from "../../src/consumer/base-event-consumer.js";

// Mock OpenTelemetry
vi.mock("@opentelemetry/api", () => ({
  propagation: {
    extract: vi.fn((_context, _carrier) => ({})),
  },
  context: {
    active: vi.fn(() => ({})),
    with: vi.fn((_ctx, fn) => fn()),
  },
  trace: {
    setSpan: vi.fn((_ctx, _span) => ({})),
  },
}));

// Mock @wallpaperdb/core telemetry
vi.mock("@wallpaperdb/core/telemetry", () => ({
  withSpan: vi.fn(async (_name, _attrs, fn) => {
    const mockSpan = {
      setAttribute: vi.fn(),
      addEvent: vi.fn(),
    };
    return fn(mockSpan);
  }),
  recordCounter: vi.fn(),
  recordHistogram: vi.fn(),
  Attributes: {
    EVENT_TYPE: "event.type",
    EVENT_ID: "event.id",
    EVENT_SUBJECT: "event.subject",
    EVENT_STREAM: "event.stream",
    EVENT_CONSUMER: "event.consumer",
    EVENT_DELIVERY_ATTEMPT: "event.delivery_attempt",
  },
}));

// Test event schema
const TestEventSchema = z.object({
  eventId: z.string().min(1),
  eventType: z.literal("test.event"),
  timestamp: z.string().datetime(),
  data: z.object({
    message: z.string(),
    count: z.number(),
  }),
});

type TestEvent = z.infer<typeof TestEventSchema>;

// Concrete implementation for testing
class TestEventConsumer extends BaseEventConsumer<typeof TestEventSchema> {
  protected readonly schema = TestEventSchema;
  protected readonly subject = "test.event";
  protected readonly eventType = "test.event";

  public handledEvents: Array<{ event: TestEvent; context: unknown }> = [];
  public validationErrors: Array<{ error: z.ZodError; rawData: unknown }> = [];
  public maxRetriesExceededErrors: Array<{ error: Error; event: TestEvent }> = [];
  public shouldThrow = false;
  public throwError: Error | null = null;

  async handleEvent(event: TestEvent, context: unknown): Promise<void> {
    if (this.shouldThrow && this.throwError) {
      throw this.throwError;
    }
    this.handledEvents.push({ event, context });
  }

  protected async onValidationError(
    error: z.ZodError,
    rawData: unknown,
    _context: unknown
  ): Promise<void> {
    this.validationErrors.push({ error, rawData });
  }

  protected async onMaxRetriesExceeded(
    error: Error,
    event: TestEvent,
    _context: unknown
  ): Promise<void> {
    this.maxRetriesExceededErrors.push({ error, event });
  }

  // Expose protected method for testing
  public async exposeProcessMessage(msg: JsMsg): Promise<void> {
    return this.processMessage(msg);
  }
}

describe("BaseEventConsumer", () => {
  let mockJetStream: JetStreamClient;
  let mockNatsConnection: NatsConnection;
  let consumer: TestEventConsumer;

  function createMockMessage(
    data: unknown,
    options?: { redelivered?: boolean; redeliveryCount?: number }
  ): JsMsg {
    const encodedData = new TextEncoder().encode(JSON.stringify(data));
    return {
      data: encodedData,
      subject: "test.event",
      sid: 1,
      reply: undefined,
      headers: {
        get: vi.fn((key: string) => {
          if (key === "traceparent") return "00-mock-trace-id-mock-span-id-01";
          if (key === "event-id") return "test-event-id";
          return undefined;
        }),
        has: vi.fn((key: string) => key === "traceparent" || key === "event-id"),
        keys: vi.fn(() => ["traceparent", "event-id"]),
      },
      info: {
        redelivered: options?.redelivered ?? false,
        redeliveryCount: options?.redeliveryCount ?? 0,
        stream: "test-stream",
        consumer: "test-consumer",
        delivered: { consumer_seq: 1, stream_seq: 1 },
        pending: 0,
        timestampNanos: Date.now() * 1_000_000,
      },
      ack: vi.fn(),
      nak: vi.fn(),
      working: vi.fn(),
      term: vi.fn(),
      json: vi.fn(() => data),
      string: vi.fn(() => JSON.stringify(data)),
    } as unknown as JsMsg;
  }

  beforeEach(() => {
    const mockConsumer = {
      consume: vi.fn(),
      info: vi.fn(() =>
        Promise.resolve({
          name: "test-consumer",
          stream_name: "test-stream",
          config: { durable_name: "test-consumer" },
        } as unknown as ConsumerInfo)
      ),
    } as unknown as Consumer;

    const mockConsumers: Consumers = {
      get: vi.fn(() => Promise.resolve(mockConsumer)),
      add: vi.fn(() => Promise.resolve(mockConsumer)),
    } as unknown as Consumers;

    mockJetStream = {
      consumers: mockConsumers,
    } as unknown as JetStreamClient;

    const mockJsm: JetStreamManager = {
      streams: {
        info: vi.fn(() =>
          Promise.resolve({
            config: { name: "test-stream" },
          } as unknown as StreamInfo)
        ),
      },
    } as unknown as JetStreamManager;

    mockNatsConnection = {
      jetstream: vi.fn(() => mockJetStream),
      jetstreamManager: vi.fn(() => Promise.resolve(mockJsm)),
      isClosed: vi.fn(() => false),
    } as unknown as NatsConnection;

    consumer = new TestEventConsumer({
      natsConnection: mockNatsConnection,
      serviceName: "test-service",
      streamName: "test-stream",
      durableName: "test-consumer",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("lifecycle", () => {
    it("should not be running initially", () => {
      expect(consumer.isRunning()).toBe(false);
    });
  });

  describe("message processing", () => {
    it("should process valid messages and ack", async () => {
      const validEvent: TestEvent = {
        eventId: "test-id-123",
        eventType: "test.event",
        timestamp: new Date().toISOString(),
        data: {
          message: "hello",
          count: 42,
        },
      };

      const msg = createMockMessage(validEvent);

      await consumer.exposeProcessMessage(msg);

      expect(consumer.handledEvents).toHaveLength(1);
      expect(consumer.handledEvents[0].event.eventId).toBe("test-id-123");
      expect(msg.ack).toHaveBeenCalled();
    });

    it("should term messages with wrong event type", async () => {
      const invalidEvent = {
        eventId: "test-id-123",
        eventType: "wrong.type", // Wrong event type
        timestamp: new Date().toISOString(),
        data: {
          message: "hello",
          count: 42,
        },
      };

      const msg = createMockMessage(invalidEvent);

      await consumer.exposeProcessMessage(msg);

      expect(consumer.handledEvents).toHaveLength(0);
      expect(consumer.validationErrors).toHaveLength(1);
      expect(msg.term).toHaveBeenCalled(); // Term for validation errors (won't succeed on retry)
    });

    it("should call onValidationError for invalid messages", async () => {
      const invalidEvent = {
        eventId: "test-id-123",
        // Missing eventType
        timestamp: new Date().toISOString(),
        data: {
          message: "hello",
          count: 42,
        },
      };

      const msg = createMockMessage(invalidEvent);

      await consumer.exposeProcessMessage(msg);

      expect(consumer.validationErrors).toHaveLength(1);
      expect(consumer.validationErrors[0].rawData).toEqual(invalidEvent);
    });

    it("should nak messages that throw errors during processing", async () => {
      const validEvent: TestEvent = {
        eventId: "test-id-123",
        eventType: "test.event",
        timestamp: new Date().toISOString(),
        data: {
          message: "hello",
          count: 42,
        },
      };

      consumer.shouldThrow = true;
      consumer.throwError = new Error("Processing failed");

      const msg = createMockMessage(validEvent);

      await consumer.exposeProcessMessage(msg);

      expect(consumer.handledEvents).toHaveLength(0);
      expect(msg.nak).toHaveBeenCalled();
    });

    it("should term messages after max retries exceeded", async () => {
      const validEvent: TestEvent = {
        eventId: "test-id-123",
        eventType: "test.event",
        timestamp: new Date().toISOString(),
        data: {
          message: "hello",
          count: 42,
        },
      };

      consumer.shouldThrow = true;
      consumer.throwError = new Error("Processing failed");

      // Simulate message that has been redelivered 3+ times
      const msg = createMockMessage(validEvent, { redeliveryCount: 4 });

      await consumer.exposeProcessMessage(msg);

      expect(consumer.maxRetriesExceededErrors).toHaveLength(1);
      expect(msg.term).toHaveBeenCalled();
      expect(msg.nak).not.toHaveBeenCalled();
    });

    it("should term messages with invalid JSON", async () => {
      const msg = {
        data: new TextEncoder().encode("not valid json {{{"),
        subject: "test.event",
        headers: {
          get: vi.fn(() => undefined),
          has: vi.fn(() => false),
          keys: vi.fn(() => []),
        },
        info: {
          redeliveryCount: 0,
          stream: "test-stream",
          consumer: "test-consumer",
        },
        ack: vi.fn(),
        nak: vi.fn(),
        term: vi.fn(),
      } as unknown as JsMsg;

      await consumer.exposeProcessMessage(msg);

      expect(msg.term).toHaveBeenCalled();
      expect(consumer.handledEvents).toHaveLength(0);
    });

    it("should wrap processing in telemetry span", async () => {
      const { withSpan } = await import("@wallpaperdb/core/telemetry");

      const validEvent: TestEvent = {
        eventId: "test-id-123",
        eventType: "test.event",
        timestamp: new Date().toISOString(),
        data: {
          message: "hello",
          count: 42,
        },
      };

      const msg = createMockMessage(validEvent);

      await consumer.exposeProcessMessage(msg);

      expect(withSpan).toHaveBeenCalledWith(
        "events.consume",
        expect.objectContaining({
          "event.type": "test.event",
          "event.subject": "test.event",
        }),
        expect.any(Function)
      );
    });

    it("should record success metrics", async () => {
      const { recordCounter, recordHistogram } = await import("@wallpaperdb/core/telemetry");

      const validEvent: TestEvent = {
        eventId: "test-id-123",
        eventType: "test.event",
        timestamp: new Date().toISOString(),
        data: {
          message: "hello",
          count: 42,
        },
      };

      const msg = createMockMessage(validEvent);

      await consumer.exposeProcessMessage(msg);

      expect(recordCounter).toHaveBeenCalledWith(
        "events.consumed.total",
        1,
        expect.objectContaining({
          "event.type": "test.event",
          status: "success",
        })
      );
      expect(recordHistogram).toHaveBeenCalledWith(
        "events.consume_duration_ms",
        expect.any(Number),
        expect.objectContaining({
          "event.type": "test.event",
        })
      );
    });
  });

  describe("message context", () => {
    it("should pass message context to handler", async () => {
      const validEvent: TestEvent = {
        eventId: "test-id-123",
        eventType: "test.event",
        timestamp: new Date().toISOString(),
        data: {
          message: "hello",
          count: 42,
        },
      };

      const msg = createMockMessage(validEvent, { redeliveryCount: 2 });

      await consumer.exposeProcessMessage(msg);

      expect(consumer.handledEvents).toHaveLength(1);
      const context = consumer.handledEvents[0].context as {
        eventId: string;
        deliveryAttempt: number;
        stream: string;
        consumer: string;
      };
      expect(context.eventId).toBe("test-id-123");
      expect(context.deliveryAttempt).toBe(2);
      expect(context.stream).toBe("test-stream");
      expect(context.consumer).toBe("test-consumer");
    });
  });
});
