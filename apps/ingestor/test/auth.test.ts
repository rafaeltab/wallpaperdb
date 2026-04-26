import "reflect-metadata";
import {
    createDefaultTesterBuilder,
    DockerTesterBuilder,
    FixturesTesterBuilder,
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
import { uploadFile } from "./helpers.js";

function mockAuthHeader(userId = "user_test_001"): Record<string, string> {
    const encoded = Buffer.from(JSON.stringify({ id: userId })).toString("base64");
    return { authorization: `Bearer ${encoded}` };
}

describe("Auth Integration", () => {
    const setup = () => {
        const TesterClass = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .with(MinioTesterBuilder)
            .with(NatsTesterBuilder)
            .with(RedisTesterBuilder)
            .with(FixturesTesterBuilder)
            .with(IngestorMigrationsTesterBuilder)
            .with(InProcessIngestorTesterBuilder)
            .build();

        const tester = new TesterClass();

        tester
            .withPostgres((b) => b.withDatabase(`test_auth_${Date.now()}`))
            .withMinio()
            .withMinioBucket("wallpapers")
            .withMinioAutoCleanup()
            .withNats((b) => b.withJetstream())
            .withStream("WALLPAPER")
            .withNatsAutoCleanup()
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

    describe("skipAuth routes", () => {
        it("GET /health without auth returns 200", async () => {
            const response = await fastify.inject({
                method: "GET",
                url: "/health",
            });

            expect(response.statusCode).toBe(200);
        });

        it("GET /ready without auth returns 200", async () => {
            const response = await fastify.inject({
                method: "GET",
                url: "/ready",
            });

            expect(response.statusCode).toBe(200);
        });

        it("POST /upload without auth still works (temporary skipAuth)", async () => {
            const userId = tester.fixtures.generateTestUserId();
            const filename = tester.fixtures.generateTestFilename("jpg");
            const imageBuffer = await tester.fixtures.images.validJpeg();

            const response = await uploadFile(fastify, {
                file: imageBuffer,
                filename,
                userId,
                mimeType: "image/jpeg",
            });

            expect(response.statusCode).toBe(200);
        });
    });

    describe("auth-by-default", () => {
        it("returns 401 for a route without skipAuth and no auth header", async () => {
            const response = await fastify.inject({
                method: "GET",
                url: "/documentation/json",
            });

            expect(response.statusCode).toBe(401);

            const body = JSON.parse(response.body);
            expect(body.status).toBe(401);
            expect(body.title).toBe("Unauthorized");
            expect(body.type).toBe("https://wallpaperdb.example/problems/unauthorized");
        });

        it("returns 401 Problem Details with correct content-type", async () => {
            const response = await fastify.inject({
                method: "GET",
                url: "/documentation/json",
            });

            expect(response.headers["content-type"]).toContain("application/problem+json");
        });

        it("allows request through with valid mock auth header", async () => {
            const response = await fastify.inject({
                method: "GET",
                url: "/documentation/json",
                headers: mockAuthHeader(),
            });

            expect(response.statusCode).not.toBe(401);
        });
    });
});
