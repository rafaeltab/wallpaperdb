import {
    createDefaultTesterBuilder,
    DockerTesterBuilder,
    MinioTesterBuilder,
    NatsTesterBuilder,
    PostgresTesterBuilder,
    RedisTesterBuilder,
} from "@wallpaperdb/test-utils";
import { request } from "undici";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import {
    ContainerizedIngestorTesterBuilder,
    IngestorMigrationsTesterBuilder,
} from "./builders/index.js";

describe("Health Endpoint E2E", () => {
    const setup = () => {
        const TesterClass = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .with(MinioTesterBuilder)
            .with(NatsTesterBuilder)
            .with(RedisTesterBuilder)
            .with(IngestorMigrationsTesterBuilder)
            .with(ContainerizedIngestorTesterBuilder)
            .build();

        const tester = new TesterClass();

        tester
            .withPostgres((builder) =>
                builder.withDatabase(`test_e2e_health_${Date.now()}`),
            )
            .withPostgresAutoCleanup(["wallpapers"])
            .withMinio()
            .withMinioBucket("wallpapers")
            .withMinioAutoCleanup()
            .withNats()
            .withNatsAutoCleanup()
            .withStream("WALLPAPER")
            .withMigrations()
            .withContainerizedApp();
        return tester;
    };

    let tester: ReturnType<typeof setup>;
    let baseUrl: string;

    beforeAll(async () => {
        tester = setup();

        await tester.setup();
        baseUrl = tester.getBaseUrl();
    }, 120000);

    afterAll(async () => {
        await tester.destroy();
    });

    afterEach(async () => {
        await tester.cleanup();
    });

    test("GET /health returns healthy status", async () => {
        // Act: Make HTTP request to Docker container
        const response = await request(`${baseUrl}/health`, {
            method: "GET",
        });

        // Verify: HTTP response
        expect(response.statusCode).toBe(200);

        const body = await response.body.json();

        // Verify: Response structure
        expect(body).toMatchObject({
            status: "healthy",
            checks: {
                database: true,
                minio: true,
                nats: true,
                otel: true,
            },
            timestamp: expect.any(String),
        });
    });

    test("GET /ready returns ready status", async () => {
        // Act: Make HTTP request to Docker container
        const response = await request(`${baseUrl}/ready`, {
            method: "GET",
        });

        // Verify: HTTP response
        expect(response.statusCode).toBe(200);

        const body = await response.body.json();

        // Verify: Response structure
        expect(body).toMatchObject({
            ready: true,
            timestamp: expect.any(String),
        });
    });
});
