import "reflect-metadata";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { getOtelSdk, initializeOtel, shutdownOtel } from "../src/otel-init.js";

describe("OTEL Initialization", () => {
	afterEach(async () => {
		await shutdownOtel();
	});

	it("should initialize SDK when endpoint is configured", () => {
		const config = loadConfig();
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
		const config = { ...loadConfig(), otelEndpoint: undefined };
		const sdk = initializeOtel(config);
		expect(sdk).toBeNull();
		expect(getOtelSdk()).toBeNull();
	});

	it("should be idempotent (safe to call multiple times)", () => {
		const config = loadConfig();
		const sdk1 = initializeOtel(config);
		const sdk2 = initializeOtel(config);
		expect(sdk1).toBe(sdk2); // Same instance
	});

	it("should shutdown gracefully", async () => {
		const config = loadConfig();
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
