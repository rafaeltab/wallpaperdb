import {
    createDefaultTesterBuilder,
    DockerTesterBuilder,
    MinioTesterBuilder,
    NatsTesterBuilder,
    PostgresTesterBuilder,
    RedisTesterBuilder,
} from "@wallpaperdb/test-utils";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
    IngestorMigrationsTesterBuilder,
    InProcessIngestorTesterBuilder,
} from "./builders/index.js";

describe("Health Endpoint", () => {
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

        tester
            .withPostgres((b) => b.withDatabase(`test_health_${Date.now()}`))
            .withMinio()
            .withMinioBucket("wallpapers")
            .withNats((b) => b.withJetstream())
            .withMigrations()
            .withInProcessApp();

        return tester;
    };

    let tester: ReturnType<typeof setup>;
    let fastify: FastifyInstance;

    beforeAll(async () => {
        tester = setup();
        await tester.setup();
        fastify = tester.getApp();
    }, 60000);

    afterAll(async () => {
        await tester.destroy();
    });

    it("should return healthy status when all services are up", async () => {
        const response = await fastify.inject({
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
});
