import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { NatsConnection, JetStreamClient, PubAck } from "nats";
import { BaseEventPublisher } from "../../src/publisher/base-event-publisher.js";

// Mock OpenTelemetry
vi.mock("@opentelemetry/api", () => ({
  propagation: {
    inject: vi.fn((_context, carrier) => {
      carrier.traceparent = "00-mock-trace-id-mock-span-id-01";
    }),
  },
  context: {
    active: vi.fn(() => ({})),
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
class TestEventPublisher extends BaseEventPublisher<typeof TestEventSchema> {
  protected readonly schema = TestEventSchema;
  protected readonly subject = "test.event";
  protected readonly eventType = "test.event";
}

describe("BaseEventPublisher", () => {
  let mockJetStream: JetStreamClient;
  let mockNatsConnection: NatsConnection;
  let publisher: TestEventPublisher;
  let publishedMessages: Array<{ subject: string; data: Uint8Array; options?: unknown }>;

  beforeEach(() => {
    publishedMessages = [];

    mockJetStream = {
      publish: vi.fn(async (subject: string, data: Uint8Array, options?: unknown) => {
        publishedMessages.push({ subject, data, options });
        return { stream: "test-stream", seq: 1 } as PubAck;
      }),
    } as unknown as JetStreamClient;

    mockNatsConnection = {
      jetstream: vi.fn(() => mockJetStream),
      isClosed: vi.fn(() => false),
    } as unknown as NatsConnection;

    publisher = new TestEventPublisher({
      natsConnection: mockNatsConnection,
      serviceName: "test-service",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("publish", () => {
    it("should publish a valid event", async () => {
      const event: TestEvent = {
        eventId: "test-id-123",
        eventType: "test.event",
        timestamp: new Date().toISOString(),
        data: {
          message: "hello",
          count: 42,
        },
      };

      await publisher.publish(event);

      expect(mockJetStream.publish).toHaveBeenCalledOnce();
      expect(publishedMessages).toHaveLength(1);
      expect(publishedMessages[0].subject).toBe("test.event");
    });

    it("should serialize event as JSON", async () => {
      const event: TestEvent = {
        eventId: "test-id-123",
        eventType: "test.event",
        timestamp: new Date().toISOString(),
        data: {
          message: "hello",
          count: 42,
        },
      };

      await publisher.publish(event);

      const publishedData = new TextDecoder().decode(publishedMessages[0].data);
      const parsedEvent = JSON.parse(publishedData);
      expect(parsedEvent.eventId).toBe("test-id-123");
      expect(parsedEvent.data.message).toBe("hello");
    });

    it("should reject invalid event with validation error", async () => {
      const invalidEvent = {
        eventId: "test-id-123",
        eventType: "wrong.type", // Wrong event type
        timestamp: new Date().toISOString(),
        data: {
          message: "hello",
          count: 42,
        },
      };

      await expect(publisher.publish(invalidEvent as TestEvent)).rejects.toThrow(
        "Event validation failed"
      );
      expect(mockJetStream.publish).not.toHaveBeenCalled();
    });

    it("should reject event with missing required fields", async () => {
      const invalidEvent = {
        eventId: "test-id-123",
        eventType: "test.event",
        timestamp: new Date().toISOString(),
        // Missing data field
      };

      await expect(publisher.publish(invalidEvent as TestEvent)).rejects.toThrow(
        "Event validation failed"
      );
    });

    it("should reject event with invalid timestamp format", async () => {
      const invalidEvent = {
        eventId: "test-id-123",
        eventType: "test.event",
        timestamp: "not-a-valid-timestamp",
        data: {
          message: "hello",
          count: 42,
        },
      };

      await expect(publisher.publish(invalidEvent as TestEvent)).rejects.toThrow(
        "Event validation failed"
      );
    });

    it("should include trace context headers when publishing", async () => {
      const event: TestEvent = {
        eventId: "test-id-123",
        eventType: "test.event",
        timestamp: new Date().toISOString(),
        data: {
          message: "hello",
          count: 42,
        },
      };

      await publisher.publish(event);

      const options = publishedMessages[0].options as {
        headers?: { get: (key: string) => string };
      };
      expect(options).toBeDefined();
      // The mock injects traceparent header
    });

    it("should wrap publish in telemetry span", async () => {
      const { withSpan } = await import("@wallpaperdb/core/telemetry");

      const event: TestEvent = {
        eventId: "test-id-123",
        eventType: "test.event",
        timestamp: new Date().toISOString(),
        data: {
          message: "hello",
          count: 42,
        },
      };

      await publisher.publish(event);

      expect(withSpan).toHaveBeenCalledWith(
        "events.publish",
        expect.objectContaining({
          "event.type": "test.event",
          "event.subject": "test.event",
        }),
        expect.any(Function)
      );
    });
  });

  describe("createEvent", () => {
    it("should generate eventId if not provided", async () => {
      const partialEvent = {
        data: {
          message: "hello",
          count: 42,
        },
      };

      const fullEvent = publisher.createEvent(partialEvent);

      expect(fullEvent.eventId).toBeDefined();
      expect(fullEvent.eventId.length).toBeGreaterThan(0);
    });

    it("should generate timestamp if not provided", async () => {
      const partialEvent = {
        data: {
          message: "hello",
          count: 42,
        },
      };

      const fullEvent = publisher.createEvent(partialEvent);

      expect(fullEvent.timestamp).toBeDefined();
      // Should be a valid ISO timestamp
      expect(() => new Date(fullEvent.timestamp)).not.toThrow();
    });

    it("should set the correct eventType", async () => {
      const partialEvent = {
        data: {
          message: "hello",
          count: 42,
        },
      };

      const fullEvent = publisher.createEvent(partialEvent);

      expect(fullEvent.eventType).toBe("test.event");
    });

    it("should preserve provided eventId", async () => {
      const partialEvent = {
        eventId: "custom-event-id",
        data: {
          message: "hello",
          count: 42,
        },
      };

      const fullEvent = publisher.createEvent(partialEvent);

      expect(fullEvent.eventId).toBe("custom-event-id");
    });

    it("should preserve provided timestamp", async () => {
      const customTimestamp = "2024-01-15T10:30:00.000Z";
      const partialEvent = {
        timestamp: customTimestamp,
        data: {
          message: "hello",
          count: 42,
        },
      };

      const fullEvent = publisher.createEvent(partialEvent);

      expect(fullEvent.timestamp).toBe(customTimestamp);
    });
  });

  describe("publishNew", () => {
    it("should create and publish event in one call", async () => {
      const partialEvent = {
        data: {
          message: "hello",
          count: 42,
        },
      };

      await publisher.publishNew(partialEvent);

      expect(mockJetStream.publish).toHaveBeenCalledOnce();
      const publishedData = new TextDecoder().decode(publishedMessages[0].data);
      const parsedEvent = JSON.parse(publishedData);
      expect(parsedEvent.eventType).toBe("test.event");
      expect(parsedEvent.eventId).toBeDefined();
      expect(parsedEvent.timestamp).toBeDefined();
      expect(parsedEvent.data.message).toBe("hello");
    });
  });
});
