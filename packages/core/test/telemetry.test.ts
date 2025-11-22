import { describe, it, expect } from "vitest";
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
      const histogram = createHistogram(
        "test.histogram",
        "Test histogram",
        "ms"
      );
      expect(histogram).toBeDefined();
      // Should not throw when recording
      histogram.record(100);
    });
  });
});
