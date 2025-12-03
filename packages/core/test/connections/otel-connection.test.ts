import type { NodeSDK } from "@opentelemetry/sdk-node";
import { afterEach, describe, expect, it } from "vitest";
import { createOtelSdk, shutdownOtelSdk } from "../../src/connections/otel.js";
import { OtelConnection } from "../../src/connections/otel-connection.js";
import type { OtelConfig } from "../../src/connections/types.js";

describe("OtelConnection (Integration)", () => {
  let createdSdks: NodeSDK[] = [];

  afterEach(async () => {
    // Cleanup any SDKs created during tests
    for (const sdk of createdSdks) {
      try {
        await shutdownOtelSdk(sdk);
      } catch {
        // Ignore errors during cleanup
      }
    }
    createdSdks = [];
  });

  describe("Pattern A: Create SDK in connection", () => {
    it("should create SDK with config", async () => {
      const config: OtelConfig = {
        otelServiceName: "test-service",
        otelEndpoint: "http://localhost:4318",
      };

      const connection = new OtelConnection(config);
      const sdk = await connection.initialize();

      createdSdks.push(sdk);

      expect(connection.isInitialized()).toBe(true);
      expect(connection.getClient()).toBeDefined();
      expect(connection.getClient()).toBe(sdk);
    });

    it("should apply custom options", async () => {
      const config: OtelConfig = {
        otelServiceName: "test-service-custom",
      };

      const connection = new OtelConnection(config, {
        metricExportIntervalMs: 30000,
        disableFsInstrumentation: false,
        enableLogging: false,
      });

      const sdk = await connection.initialize();
      createdSdks.push(sdk);

      expect(connection.isInitialized()).toBe(true);
      expect(sdk).toBeDefined();
    });

    it("should shutdown SDK on close", async () => {
      const config: OtelConfig = {
        otelServiceName: "test-service-shutdown",
      };

      const connection = new OtelConnection(config);
      await connection.initialize();

      expect(connection.isInitialized()).toBe(true);

      await connection.close();

      expect(connection.isInitialized()).toBe(false);
    });
  });

  describe("Pattern B: Wrap existing SDK", () => {
    it("should wrap pre-initialized SDK", async () => {
      const config: OtelConfig = {
        otelServiceName: "test-service-wrapped",
      };

      // Create SDK outside connection (simulates otel-init.ts pattern)
      const externalSdk = createOtelSdk(config);
      createdSdks.push(externalSdk);

      const connection = new OtelConnection(config, {
        existingSdk: externalSdk,
      });
      const sdk = await connection.initialize();

      expect(connection.isInitialized()).toBe(true);
      expect(connection.getClient()).toBe(externalSdk); // Same instance
      expect(sdk).toBe(externalSdk);
    });

    it("should not shutdown external SDK on close", async () => {
      const config: OtelConfig = {
        otelServiceName: "test-service-external",
      };

      // Create SDK outside connection
      const externalSdk = createOtelSdk(config);
      createdSdks.push(externalSdk);

      const connection = new OtelConnection(config, {
        existingSdk: externalSdk,
      });
      await connection.initialize();

      // Close connection - should NOT shutdown external SDK
      await connection.close();

      expect(connection.isInitialized()).toBe(false);
      // External SDK should still be usable (we'll shut it down in afterEach)
    });

    it("should throw if accessing before initialize", () => {
      const config: OtelConfig = { otelServiceName: "test" };
      const connection = new OtelConnection(config);

      expect(() => connection.getClient()).toThrow();
    });
  });

  describe("Health checks", () => {
    it("should return true when initialized", async () => {
      const config: OtelConfig = {
        otelServiceName: "test-health",
      };

      const connection = new OtelConnection(config);
      await connection.initialize();

      createdSdks.push(connection.getClient());

      const health = await connection.checkHealth();
      expect(health).toBe(true);

      await connection.close();
    });

    it("should return false when not initialized", async () => {
      const config: OtelConfig = {
        otelServiceName: "test-health-not-init",
      };

      const connection = new OtelConnection(config);

      const health = await connection.checkHealth();
      expect(health).toBe(false);
    });
  });

  describe("Idempotency", () => {
    it("should be idempotent - same SDK returned on multiple initialize calls", async () => {
      const config: OtelConfig = {
        otelServiceName: "test-idempotent",
      };

      const connection = new OtelConnection(config);

      const sdk1 = await connection.initialize();
      const sdk2 = await connection.initialize();
      const sdk3 = await connection.initialize();

      createdSdks.push(sdk1);

      expect(sdk1).toBe(sdk2);
      expect(sdk2).toBe(sdk3);
      expect(connection.isInitialized()).toBe(true);
    });

    it("should be safe to call close multiple times", async () => {
      const config: OtelConfig = {
        otelServiceName: "test-multiple-close",
      };

      const connection = new OtelConnection(config);
      await connection.initialize();

      await connection.close();
      await connection.close(); // Should not throw
      await connection.close(); // Should not throw

      expect(connection.isInitialized()).toBe(false);
    });
  });
});
