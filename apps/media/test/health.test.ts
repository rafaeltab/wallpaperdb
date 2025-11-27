import "reflect-metadata";
import {
	createDefaultTesterBuilder,
	DockerTesterBuilder,
	MinioTesterBuilder,
	NatsTesterBuilder,
	PostgresTesterBuilder,
} from "@wallpaperdb/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	InProcessMediaTesterBuilder,
	MediaMigrationsTesterBuilder,
} from "./builders/index.js";

describe("Media Service - Health Endpoint", () => {
	const setup = () => {
		const TesterClass = createDefaultTesterBuilder()
			.with(DockerTesterBuilder)
			.with(PostgresTesterBuilder)
			.with(MinioTesterBuilder)
			.with(NatsTesterBuilder)
			.with(MediaMigrationsTesterBuilder)
			.with(InProcessMediaTesterBuilder)
			.build();

		const tester = new TesterClass();

		// Configure infrastructure WITHOUT network - app runs on host
		tester
			.withPostgres((builder) =>
				builder.withDatabase(`test_media_health_${Date.now()}`),
			)
			.withMinio()
			.withMinioBucket("wallpapers")
			.withNats((builder) => builder.withJetstream())
			.withStream("WALLPAPER")
			.withMigrations()
			.withInProcessApp();
		return tester;
	};

	let tester: ReturnType<typeof setup>;

	beforeAll(async () => {
		// Build test environment with builder composition
		// Note: DockerTesterBuilder is required by infrastructure builders,
		// but we DON'T call withNetwork() - containers run standalone with exposed ports
		tester = setup();

		await tester.setup();
	}, 60000); // 60 second timeout for container startup

	afterAll(async () => {
		await tester.destroy();
	});

	it("should return healthy status when all services are up", async () => {
		const app = tester.getApp();

		const response = await app.inject({
			method: "GET",
			url: "/health",
		});

		expect(response.statusCode).toBe(200);

		const body = JSON.parse(response.body);
		expect(body.status).toBe("healthy");
		expect(body.checks).toBeDefined();
		expect(body.checks.database).toBeDefined();
		expect(body.checks.minio).toBeDefined();
		expect(body.checks.nats).toBeDefined();
		expect(body.timestamp).toBeDefined();
	});

	it("should return ready status", async () => {
		const app = tester.getApp();

		const response = await app.inject({
			method: "GET",
			url: "/ready",
		});

		expect(response.statusCode).toBe(200);

		const body = JSON.parse(response.body);
		expect(body.ready).toBeTruthy();
	});

	it("should have correct health check structure", async () => {
		const app = tester.getApp();

		const response = await app.inject({
			method: "GET",
			url: "/health",
		});

		const body = JSON.parse(response.body);

		// Verify all required dependencies are checked
		expect(body.checks).toHaveProperty("database");
		expect(body.checks).toHaveProperty("minio");
		expect(body.checks).toHaveProperty("nats");

		// Media service should have otel check (initialized)
		expect(body.checks).toHaveProperty("otel");
		expect(body.checks.otel).toBe(true);

		// Media service should NOT have redis check in Phase 1
		expect(body.checks).not.toHaveProperty("redis");
	});
});
