import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  HealthAggregator,
  getHealthStatusCode,
  getReadyStatusCode,
  getLiveStatusCode,
  createSimpleHealthResponse,
  type HealthResponse,
  type ReadyResponse,
  type LiveResponse,
} from "../src/health/index.js";

describe("HealthAggregator", () => {
  let aggregator: HealthAggregator;

  beforeEach(() => {
    aggregator = new HealthAggregator();
  });

  describe("checkHealth", () => {
    it("should return healthy when all checks pass", async () => {
      aggregator.register("db", async () => true);
      aggregator.register("cache", async () => true);

      const result = await aggregator.checkHealth();

      expect(result.status).toBe("healthy");
      expect(result.checks).toEqual({ db: true, cache: true });
      expect(result.timestamp).toBeDefined();
      expect(result.totalDurationMs).toBeDefined();
    });

    it("should return unhealthy when all checks fail", async () => {
      aggregator.register("db", async () => false);
      aggregator.register("cache", async () => false);

      const result = await aggregator.checkHealth();

      expect(result.status).toBe("unhealthy");
      expect(result.checks).toEqual({ db: false, cache: false });
    });

    it("should return degraded when some checks fail", async () => {
      aggregator.register("db", async () => true);
      aggregator.register("cache", async () => false);

      const result = await aggregator.checkHealth();

      expect(result.status).toBe("degraded");
      expect(result.checks).toEqual({ db: true, cache: false });
    });

    it("should return healthy when no checks are registered", async () => {
      const result = await aggregator.checkHealth();

      expect(result.status).toBe("healthy");
      expect(result.checks).toEqual({});
    });

    it("should return shutting_down when marked as shutting down", async () => {
      aggregator.register("db", async () => true);
      aggregator.setShuttingDown(true);

      const result = await aggregator.checkHealth();

      expect(result.status).toBe("shutting_down");
      expect(result.checks).toEqual({});
    });

    it("should handle check that throws error", async () => {
      aggregator.register("db", async () => {
        throw new Error("Connection failed");
      });
      aggregator.register("cache", async () => true);

      const result = await aggregator.checkHealth();

      expect(result.status).toBe("degraded");
      expect(result.checks.db).toBe(false);
      expect(result.checks.cache).toBe(true);
    });

    it("should handle check timeout", async () => {
      const slowAggregator = new HealthAggregator({ checkTimeoutMs: 50 });

      slowAggregator.register("slow", async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return true;
      });
      slowAggregator.register("fast", async () => true);

      const result = await slowAggregator.checkHealth();

      expect(result.status).toBe("degraded");
      expect(result.checks.slow).toBe(false);
      expect(result.checks.fast).toBe(true);
    });

    it("should run checks in parallel by default", async () => {
      const startTimes: number[] = [];

      aggregator.register("check1", async () => {
        startTimes.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 50));
        return true;
      });
      aggregator.register("check2", async () => {
        startTimes.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 50));
        return true;
      });

      await aggregator.checkHealth();

      // If parallel, start times should be within a few ms of each other
      expect(Math.abs(startTimes[0] - startTimes[1])).toBeLessThan(20);
    });

    it("should run checks sequentially when configured", async () => {
      const sequentialAggregator = new HealthAggregator({ parallel: false });
      const startTimes: number[] = [];

      sequentialAggregator.register("check1", async () => {
        startTimes.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 50));
        return true;
      });
      sequentialAggregator.register("check2", async () => {
        startTimes.push(Date.now());
        await new Promise((resolve) => setTimeout(resolve, 50));
        return true;
      });

      await sequentialAggregator.checkHealth();

      // If sequential, second check should start after first completes (~50ms later)
      expect(startTimes[1] - startTimes[0]).toBeGreaterThanOrEqual(45);
    });
  });

  describe("register/unregister", () => {
    it("should register and run health checks", async () => {
      const check = vi.fn().mockResolvedValue(true);
      aggregator.register("test", check);

      await aggregator.checkHealth();

      expect(check).toHaveBeenCalledOnce();
    });

    it("should unregister health checks", async () => {
      const check = vi.fn().mockResolvedValue(true);
      aggregator.register("test", check);
      aggregator.unregister("test");

      const result = await aggregator.checkHealth();

      expect(check).not.toHaveBeenCalled();
      expect(result.checks.test).toBeUndefined();
    });
  });

  describe("checkReady", () => {
    it("should return ready when initialized and not shutting down", () => {
      aggregator.setInitialized(true);

      const result = aggregator.checkReady();

      expect(result.ready).toBe(true);
      expect(result.timestamp).toBeDefined();
      expect(result.reason).toBeUndefined();
    });

    it("should return not ready when not initialized", () => {
      const result = aggregator.checkReady();

      expect(result.ready).toBe(false);
      expect(result.reason).toBe("Service is not yet initialized");
    });

    it("should return not ready when shutting down", () => {
      aggregator.setInitialized(true);
      aggregator.setShuttingDown(true);

      const result = aggregator.checkReady();

      expect(result.ready).toBe(false);
      expect(result.reason).toBe("Service is shutting down");
    });

    it("should prioritize shutting down over not initialized", () => {
      aggregator.setShuttingDown(true);

      const result = aggregator.checkReady();

      expect(result.ready).toBe(false);
      expect(result.reason).toBe("Service is shutting down");
    });
  });

  describe("checkLive", () => {
    it("should return alive when not shutting down", () => {
      const result = aggregator.checkLive();

      expect(result.alive).toBe(true);
      expect(result.timestamp).toBeDefined();
    });

    it("should return not alive when shutting down", () => {
      aggregator.setShuttingDown(true);

      const result = aggregator.checkLive();

      expect(result.alive).toBe(false);
    });
  });
});

describe("Health Formatters", () => {
  describe("getHealthStatusCode", () => {
    it("should return 200 for healthy", () => {
      const response: HealthResponse = {
        status: "healthy",
        checks: {},
        timestamp: new Date().toISOString(),
      };

      expect(getHealthStatusCode(response)).toBe(200);
    });

    it("should return 200 for degraded", () => {
      const response: HealthResponse = {
        status: "degraded",
        checks: {},
        timestamp: new Date().toISOString(),
      };

      expect(getHealthStatusCode(response)).toBe(200);
    });

    it("should return 503 for unhealthy", () => {
      const response: HealthResponse = {
        status: "unhealthy",
        checks: {},
        timestamp: new Date().toISOString(),
      };

      expect(getHealthStatusCode(response)).toBe(503);
    });

    it("should return 503 for error", () => {
      const response: HealthResponse = {
        status: "error",
        checks: {},
        timestamp: new Date().toISOString(),
      };

      expect(getHealthStatusCode(response)).toBe(503);
    });

    it("should return 503 for shutting_down", () => {
      const response: HealthResponse = {
        status: "shutting_down",
        checks: {},
        timestamp: new Date().toISOString(),
      };

      expect(getHealthStatusCode(response)).toBe(503);
    });
  });

  describe("getReadyStatusCode", () => {
    it("should return 200 when ready", () => {
      const response: ReadyResponse = {
        ready: true,
        timestamp: new Date().toISOString(),
      };

      expect(getReadyStatusCode(response)).toBe(200);
    });

    it("should return 503 when not ready", () => {
      const response: ReadyResponse = {
        ready: false,
        timestamp: new Date().toISOString(),
      };

      expect(getReadyStatusCode(response)).toBe(503);
    });
  });

  describe("getLiveStatusCode", () => {
    it("should return 200 when alive", () => {
      const response: LiveResponse = {
        alive: true,
        timestamp: new Date().toISOString(),
      };

      expect(getLiveStatusCode(response)).toBe(200);
    });

    it("should return 503 when not alive", () => {
      const response: LiveResponse = {
        alive: false,
        timestamp: new Date().toISOString(),
      };

      expect(getLiveStatusCode(response)).toBe(503);
    });
  });

  describe("createSimpleHealthResponse", () => {
    it("should create healthy response", () => {
      const response = createSimpleHealthResponse(true);

      expect(response.status).toBe("healthy");
      expect(response.timestamp).toBeDefined();
    });

    it("should create unhealthy response", () => {
      const response = createSimpleHealthResponse(false);

      expect(response.status).toBe("unhealthy");
      expect(response.timestamp).toBeDefined();
    });
  });
});
