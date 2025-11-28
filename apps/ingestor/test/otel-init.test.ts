import "reflect-metadata";
import { afterEach, describe, expect, it } from "vitest";
import { getOtelSdk, initializeOtel, shutdownOtel } from "../src/otel-init.js";
import type { OtelConfig } from "@wallpaperdb/core/config";

describe("OTEL Initialization", () => {
    afterEach(async () => {
        await shutdownOtel();
    });

    it("should initialize SDK when endpoint is configured", () => {
        const config: OtelConfig = {
            otelEndpoint: "http://localhost:4318",
            otelServiceName: "ingestor",
        };
        const sdk = initializeOtel(config);

        // If endpoint is set in .env, SDK should be initialized
        if (config.otelEndpoint) {
            expect(sdk).toBeDefined();
            expect(sdk).not.toBeNull();
            expect(getOtelSdk()).toBe(sdk);
        } else {
            // If no endpoint, should return null
            expect(sdk).toBeNull();
            expect(getOtelSdk()).toBeNull();
        }
    });

    it("should return null when no endpoint is provided", () => {
        const config: OtelConfig = {
            otelEndpoint: undefined,
            otelServiceName: "ingestor",
        };
        const sdk = initializeOtel(config);
        expect(sdk).toBeNull();
        expect(getOtelSdk()).toBeNull();
    });

    it("should be idempotent (safe to call multiple times)", () => {
        const config: OtelConfig = {
            otelEndpoint: "http://localhost:4318",
            otelServiceName: "ingestor",
        };
        const sdk1 = initializeOtel(config);
        const sdk2 = initializeOtel(config);
        expect(sdk1).toBe(sdk2); // Same instance
    });

    it("should shutdown gracefully", async () => {
        const config: OtelConfig = {
            otelEndpoint: "http://localhost:4318",
            otelServiceName: "ingestor",
        };
        initializeOtel(config);
        await expect(shutdownOtel()).resolves.not.toThrow();
        expect(getOtelSdk()).toBeNull();
    });

    it("should shutdown gracefully even if not initialized", async () => {
        // Shutdown without initializing
        await expect(shutdownOtel()).resolves.not.toThrow();
        expect(getOtelSdk()).toBeNull();
    });
});
