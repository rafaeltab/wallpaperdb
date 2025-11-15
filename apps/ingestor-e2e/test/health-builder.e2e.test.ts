import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { request } from "undici";
import {
    createDefaultTesterBuilder,
    DockerTesterBuilder,
    PostgresTesterBuilder,
    MinioTesterBuilder,
    NatsTesterBuilder,
} from "@wallpaperdb/test-utils";
import {
    ContainerizedIngestorTesterBuilder,
    IngestorMigrationsTesterBuilder,
} from "./builders/index.js";

/**
 * Proof-of-concept E2E test using the builder pattern.
 *
 * This demonstrates the new approach as an alternative to the manual setup in setup.ts.
 * Both approaches are valid - this provides composability and type safety.
 */
describe("Health Endpoint E2E (Builder-Based)", () => {
    const setup = () => {
        // Build test environment with builder composition
        const TesterClass = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .with(MinioTesterBuilder)
            .with(NatsTesterBuilder)
            .with(IngestorMigrationsTesterBuilder)
            .with(ContainerizedIngestorTesterBuilder)
            .build();

        const tester = new TesterClass();

        // Configure infrastructure WITH network - containers communicate via network
        tester
            .withNetwork()
            .withPostgres((builder) =>
                builder
                    .withDatabase(`test_e2e_health_${Date.now()}`)
                    .withNetworkAlias("postgres"),
            )
            .withMinio((builder) => builder.withNetworkAlias("minio"))
            .withMinioBucket("wallpapers")
            .withNats((builder) => builder.withNetworkAlias("nats").withJetstream())
            .withStream("WALLPAPER")
            .withMigrations()
            .withContainerizedApp();
        return tester;
    };

    let tester: ReturnType<typeof setup>;

    beforeAll(async () => {
        tester = setup();

        await tester.setup();
    }, 120000); // 2 minute timeout for full E2E setup (includes Docker build)

    afterAll(async () => {
        if (tester) {
            await tester.destroy();
        }
    });

    test("GET /health returns healthy status", async () => {
        const baseUrl = tester.getBaseUrl();

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
        const baseUrl = tester.getBaseUrl();

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
