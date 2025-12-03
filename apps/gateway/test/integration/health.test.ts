import "reflect-metadata";
import {
    createDefaultTesterBuilder,
    DockerTesterBuilder,
    NatsTesterBuilder,
    OpenSearchTesterBuilder,
} from "@wallpaperdb/test-utils";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { InProcessGatewayTesterBuilder } from "../builders/index.js";

describe("Health and Ready Endpoints", () => {
    const setup = () => {
        const TesterClass = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(OpenSearchTesterBuilder)
            .with(NatsTesterBuilder)
            .with(InProcessGatewayTesterBuilder)
            .build();

        const tester = new TesterClass();

        tester
            .withNats((n) => n.withJetstream())
            .withStream("WALLPAPER")
            .withOpenSearch()
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

    describe("/health", () => {
        it("should return healthy status when all services are up", async () => {
            const response = await fastify.inject({
                method: "GET",
                url: "/health",
            });

            expect(response.statusCode).toBe(200);

            const body = JSON.parse(response.body);
            expect(body.status).toBe("healthy");
            expect(body.checks).toBeDefined();
            expect(body.checks.nats).toBe(true);
            expect(body.checks.opensearch).toBe(true);
            expect(body.checks.otel).toBe(true);
            expect(body.timestamp).toBeDefined();
        });
    });

    describe("/ready", () => {
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
});
