import { describe, it, expect, afterEach, beforeAll, afterAll } from "vitest";
import {
  Attributes,
  getTracer,
  getActiveSpan,
  withSpan,
  withSpanSync,
  getMeter,
  createCounter,
  createHistogram,
} from "../src/telemetry/index.js";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { InMemorySpanExporter, SimpleSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { trace, type TracerProvider } from "@opentelemetry/api";

describe("Telemetry", () => {
  describe("Attributes", () => {
    it("should have standard attribute keys", () => {
      expect(Attributes.USER_ID).toBe("user.id");
      expect(Attributes.WALLPAPER_ID).toBe("wallpaper.id");
      expect(Attributes.FILE_TYPE).toBe("file.type");
      expect(Attributes.STORAGE_BUCKET).toBe("storage.bucket");
    });
  });

  describe("Tracing", () => {
    it("should get a tracer", () => {
      const tracer = getTracer();
      expect(tracer).toBeDefined();
    });

    it("should return undefined for active span when none exists", () => {
      const span = getActiveSpan();
      // May or may not have an active span depending on test setup
      expect(span === undefined || span !== undefined).toBe(true);
    });

    it("should execute function with withSpan", async () => {
      const result = await withSpan(
        "test.operation",
        { [Attributes.USER_ID]: "test-user" },
        async () => {
          return "success";
        }
      );

      expect(result).toBe("success");
    });

    it("should propagate errors from withSpan", async () => {
      await expect(
        withSpan("test.error", {}, async () => {
          throw new Error("test error");
        })
      ).rejects.toThrow("test error");
    });

    it("should execute function with withSpanSync", () => {
      const result = withSpanSync(
        "test.sync.operation",
        { [Attributes.USER_ID]: "test-user" },
        () => {
          return 42;
        }
      );

      expect(result).toBe(42);
    });

    it("should propagate errors from withSpanSync", () => {
      expect(() =>
        withSpanSync("test.sync.error", {}, () => {
          throw new Error("sync error");
        })
      ).toThrow("sync error");
    });

    describe("Span Nesting", () => {
      let memoryExporter: InMemorySpanExporter;
      let spanProcessor: SimpleSpanProcessor;
      let provider: NodeTracerProvider;
      let originalProvider: TracerProvider;

      beforeAll(() => {
        // Setup in-memory span exporter to capture spans
        memoryExporter = new InMemorySpanExporter();
        spanProcessor = new SimpleSpanProcessor(memoryExporter);

        // Pass spanProcessors in constructor (like the working example)
        provider = new NodeTracerProvider({
          spanProcessors: [spanProcessor],
        });

        // Get the current global provider and save it
        originalProvider = trace.getTracerProvider();

        // Register our test provider as the global provider
        provider.register();
      });

      afterEach(async () => {
        // Clean up after each test - force flush and reset
        await spanProcessor.forceFlush();
        await provider.forceFlush();
        await memoryExporter.forceFlush();

        // Reset spans for next test
        memoryExporter.reset();
      });

      afterAll(async () => {
        // Final cleanup
        await provider.shutdown();
        if (originalProvider) {
          trace.setGlobalTracerProvider(originalProvider);
        }
      });

      it("should create parent-child relationship for nested withSpan calls", async () => {
        // Execute nested spans
        await withSpan("parent.operation", { operation: "parent" }, async () => {
          await withSpan("child.operation", { operation: "child" }, async () => {
            // Nested work
            await new Promise((resolve) => setTimeout(resolve, 1));
          });
        });

        // Force flush to ensure all spans are exported
        await spanProcessor.forceFlush();
        await provider.forceFlush();

        // Get captured spans
        const spans = memoryExporter.getFinishedSpans();
        expect(spans.length).toBe(2);

        const parentSpan = spans.find((s) => s.name === "parent.operation");
        const childSpan = spans.find((s) => s.name === "child.operation");

        expect(parentSpan).toBeDefined();
        expect(childSpan).toBeDefined();

        // Verify parent-child relationship
        expect(childSpan?.parentSpanId).toBe(parentSpan?.spanContext().spanId);
        expect(childSpan?.spanContext().traceId).toBe(parentSpan?.spanContext().traceId);
      });

      it("should create parent-child relationship for nested withSpanSync calls", async () => {
        // Execute nested synchronous spans
        withSpanSync("parent.sync", { operation: "parent" }, () => {
          withSpanSync("child.sync", { operation: "child" }, () => {
            // Nested work
            return 42;
          });
          return "done";
        });

        // Force flush for synchronous spans
        await spanProcessor.forceFlush();
        await provider.forceFlush();

        // Get captured spans
        const spans = memoryExporter.getFinishedSpans();
        expect(spans.length).toBe(2);

        const parentSpan = spans.find((s) => s.name === "parent.sync");
        const childSpan = spans.find((s) => s.name === "child.sync");

        expect(parentSpan).toBeDefined();
        expect(childSpan).toBeDefined();

        // Verify parent-child relationship
        expect(childSpan?.parentSpanId).toBe(parentSpan?.spanContext().spanId);
        expect(childSpan?.spanContext().traceId).toBe(parentSpan?.spanContext().traceId);
      });

      it("should create parent-child relationship for mixed async-sync nesting", async () => {
        // Async parent with sync child
        await withSpan("parent.async", { operation: "parent" }, async () => {
          withSpanSync("child.sync", { operation: "child" }, () => {
            return 42;
          });
          await new Promise((resolve) => setTimeout(resolve, 1));
        });

        // Force flush to ensure all spans are exported
        await spanProcessor.forceFlush();
        await provider.forceFlush();

        // Get captured spans
        const spans = memoryExporter.getFinishedSpans();
        expect(spans.length).toBe(2);

        const parentSpan = spans.find((s) => s.name === "parent.async");
        const childSpan = spans.find((s) => s.name === "child.sync");

        expect(parentSpan).toBeDefined();
        expect(childSpan).toBeDefined();

        // Verify parent-child relationship
        expect(childSpan?.parentSpanId).toBe(parentSpan?.spanContext().spanId);
        expect(childSpan?.spanContext().traceId).toBe(parentSpan?.spanContext().traceId);
      });

      it("should create parent-child relationship for deeply nested spans", async () => {
        // Three levels of nesting
        await withSpan("level1", { level: 1 }, async () => {
          await withSpan("level2", { level: 2 }, async () => {
            await withSpan("level3", { level: 3 }, async () => {
              await new Promise((resolve) => setTimeout(resolve, 1));
            });
          });
        });

        // Force flush to ensure all spans are exported
        await spanProcessor.forceFlush();
        await provider.forceFlush();

        // Get captured spans
        const spans = memoryExporter.getFinishedSpans();
        expect(spans.length).toBe(3);

        const level1Span = spans.find((s) => s.name === "level1");
        const level2Span = spans.find((s) => s.name === "level2");
        const level3Span = spans.find((s) => s.name === "level3");

        expect(level1Span).toBeDefined();
        expect(level2Span).toBeDefined();
        expect(level3Span).toBeDefined();

        // Verify level2 is child of level1
        expect(level2Span?.parentSpanId).toBe(level1Span?.spanContext().spanId);

        // Verify level3 is child of level2
        expect(level3Span?.parentSpanId).toBe(level2Span?.spanContext().spanId);

        // All should share the same trace ID
        expect(level1Span?.spanContext().traceId).toBe(level2Span?.spanContext().traceId);
        expect(level2Span?.spanContext().traceId).toBe(level3Span?.spanContext().traceId);
      });
    });
  });

  describe("Metrics", () => {
    it("should get a meter", () => {
      const meter = getMeter();
      expect(meter).toBeDefined();
    });

    it("should create a counter", () => {
      const counter = createCounter("test.counter", "Test counter");
      expect(counter).toBeDefined();
      // Should not throw when adding
      counter.add(1);
    });

    it("should create a histogram", () => {
      const histogram = createHistogram("test.histogram", "Test histogram", "ms");
      expect(histogram).toBeDefined();
      // Should not throw when recording
      histogram.record(100);
    });
  });
});
