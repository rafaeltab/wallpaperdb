import {
    createDefaultTesterBuilder,
    DockerTesterBuilder,
    MinioTesterBuilder,
    NatsTesterBuilder,
    PostgresTesterBuilder,
    RedisTesterBuilder,
} from "@wallpaperdb/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    IngestorMigrationsTesterBuilder,
    InProcessIngestorTesterBuilder,
} from "./builders/index.js";

describe("Health Endpoint (Builder-Based)", () => {
    const setup = () => {
        const TesterClass = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .with(MinioTesterBuilder)
            .with(NatsTesterBuilder)
            .with(RedisTesterBuilder)
            .with(IngestorMigrationsTesterBuilder)
            .with(InProcessIngestorTesterBuilder)
            .build();

        const tester = new TesterClass();

        // Configure infrastructure WITHOUT network - app runs on host
        tester
            .withPostgres((builder) =>
                builder.withDatabase(`test_health_${Date.now()}`),
            )
            .withRedis()
            .withMinio()
            .withMinioBucket("wallpapers")
            .withNats((builder) => builder.withJetstream())
            .withStream("WALLPAPER")
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
        expect(body.checks.database).toBe(true);
        expect(body.checks.minio).toBe(true);
        expect(body.checks.nats).toBe(true);
        expect(body.checks.otel).toBe(true);
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
});
