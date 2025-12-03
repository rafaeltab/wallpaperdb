import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { tester } from "./setup.js";

describe("Health and Ready Endpoints", () => {
    describe("/health", () => {
        it("should return healthy status when all services are up", async () => {
            const response = await tester.getApp().inject({
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
