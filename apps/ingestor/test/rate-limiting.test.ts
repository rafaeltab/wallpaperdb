import "reflect-metadata";
import {
    createDefaultTesterBuilder,
    DockerTesterBuilder,
    MinioTesterBuilder,
    NatsTesterBuilder,
    PostgresTesterBuilder,
    RedisTesterBuilder,
} from "@wallpaperdb/test-utils";
import FormData from "form-data";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { wallpapers } from "../src/db/schema.js";
import {
    IngestorDrizzleTesterBuilder,
    IngestorMigrationsTesterBuilder,
    InProcessIngestorTesterBuilder,
} from "./builders/index.js";
import { createTestImage } from "./fixtures.js";

function mockAuthHeader(userId: string): Record<string, string> {
    const encoded = Buffer.from(JSON.stringify({ id: userId })).toString("base64");
    return { authorization: `Bearer ${encoded}` };
}

function injectUpload(app: FastifyInstance, form: FormData, userId: string) {
    return app.inject({
        method: "POST",
        url: "/upload",
        headers: { ...form.getHeaders(), ...mockAuthHeader(userId) },
        payload: form,
    });
}

let testIdCounter = 0;

describe("Rate Limiting", () => {
    class RateLimitIngestorTesterBuilder extends InProcessIngestorTesterBuilder {
        constructor() {
            super({
                configOverrides: {
                    rateLimitMax: 15,
                    rateLimitWindowMs: 5000,
                },
                logger: false,
            });
        }
    }

    const setup = () => {
        const TesterClass = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .with(MinioTesterBuilder)
            .with(NatsTesterBuilder)
            .with(RedisTesterBuilder)
            .with(IngestorDrizzleTesterBuilder)
            .with(IngestorMigrationsTesterBuilder)
            .with(RateLimitIngestorTesterBuilder)
            .build();

        const tester = new TesterClass();

        return tester
            .withPostgres((builder) =>
                builder.withDatabase(`test_ratelimit_${Date.now()}`),
            )
            .withMinio()
            .withMinioBucket("wallpapers")
            .withMinioAutoCleanup()
            .withNats((builder) => builder.withJetstream())
            .withStream("WALLPAPER")
            .withMigrations()
            .withInProcessApp();
    };

    let tester: ReturnType<typeof setup>;

    beforeAll(async () => {
        tester = setup();
        await tester.setup();
    });

    afterAll(async () => {
        await tester.destroy();
    });

    beforeEach(async () => {
        await tester.getDrizzle().delete(wallpapers);
    });

    it("should allow uploads within rate limit", async () => {
        const userId = `user_ratelimit_test_${++testIdCounter}`;
        const db = tester.getDrizzle();
        const app = tester.getApp();

        for (let i = 0; i < 5; i++) {
            const testImage = await createTestImage({
                width: 1920,
                height: 1080,
                format: "jpeg",
                color: { r: 10 + i, g: 10 + i, b: 10 + i },
            });
            const form = new FormData();
            form.append("file", testImage, {
                filename: `test-${i}.jpg`,
                contentType: "image/jpeg",
            });

            const response = await injectUpload(app, form, userId);
            expect(response.statusCode).toBe(200);
            const body = JSON.parse(response.body);
            expect(body.id).toBeDefined();
        }

        const allUploads = await db.select().from(wallpapers);
        expect(allUploads.length).toBe(5);
    });

    it("should return 429 when user exceeds rate limit", async () => {
        const userId = `user_exceed_limit_${++testIdCounter}`;
        const db = tester.getDrizzle();
        const app = tester.getApp();

        for (let i = 0; i < 15; i++) {
            const testImage = await createTestImage({
                width: 1920,
                height: 1080,
                format: "jpeg",
                color: { r: 20 + i, g: 20 + i, b: 20 + i },
            });
            const form = new FormData();
            form.append("file", testImage, {
                filename: `test-${i}.jpg`,
                contentType: "image/jpeg",
            });

            const response = await injectUpload(app, form, userId);
            expect(response.statusCode).toBe(200);
        }

        const testImage11 = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
            color: { r: 30, g: 30, b: 30 },
        });
        const form = new FormData();
        form.append("file", testImage11, {
            filename: "test-11.jpg",
            contentType: "image/jpeg",
        });

        const response = await injectUpload(app, form, userId);
        expect(response.statusCode).toBe(429);

        const allUploads = await db.select().from(wallpapers);
        expect(allUploads.length).toBe(15);
    });

    it("should return RFC 7807 Problem Details on rate limit exceeded", async () => {
        const userId = `user_rfc7807_test_${++testIdCounter}`;
        const app = tester.getApp();

        for (let i = 0; i < 15; i++) {
            const testImage = await createTestImage({
                width: 1920,
                height: 1080,
                format: "jpeg",
                color: { r: 40 + i, g: 40 + i, b: 40 + i },
            });
            const form = new FormData();
            form.append("file", testImage, {
                filename: `test-${i}.jpg`,
                contentType: "image/jpeg",
            });

            await injectUpload(app, form, userId);
        }

        const testImageExceed = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
            color: { r: 50, g: 50, b: 50 },
        });
        const form = new FormData();
        form.append("file", testImageExceed, {
            filename: "test-exceed.jpg",
            contentType: "image/jpeg",
        });

        const response = await injectUpload(app, form, userId);

        expect(response.statusCode).toBe(429);
        expect(response.headers["content-type"]).toContain("application/problem+json");

        const body = JSON.parse(response.body);
        expect(body.type).toBe("https://wallpaperdb.example/problems/rate-limit-exceeded");
        expect(body.title).toBe("Rate Limit Exceeded");
        expect(body.status).toBe(429);
        expect(body.detail).toBeDefined();
        expect(body.instance).toBe("/upload");
        expect(body.retryAfter).toBeDefined();
        expect(typeof body.retryAfter).toBe("number");
    });

    it("should apply rate limits per user independently", async () => {
        const timestamp = ++testIdCounter;
        const userA = `user_a_isolation_${timestamp}`;
        const userB = `user_b_isolation_${timestamp}`;
        const app = tester.getApp();

        for (let i = 0; i < 15; i++) {
            const testImage = await createTestImage({
                width: 1920,
                height: 1080,
                format: "jpeg",
                color: { r: 60 + i, g: 60 + i, b: 60 + i },
            });
            const form = new FormData();
            form.append("file", testImage, {
                filename: `userA-${i}.jpg`,
                contentType: "image/jpeg",
            });

            const response = await injectUpload(app, form, userA);
            expect(response.statusCode).toBe(200);
        }

        const testImageA11 = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
            color: { r: 70, g: 70, b: 70 },
        });
        const formA11 = new FormData();
        formA11.append("file", testImageA11, {
            filename: "userA-11.jpg",
            contentType: "image/jpeg",
        });

        const responseA11 = await injectUpload(app, formA11, userA);
        expect(responseA11.statusCode).toBe(429);

        const testImageB1 = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
            color: { r: 80, g: 80, b: 80 },
        });
        const formB1 = new FormData();
        formB1.append("file", testImageB1, {
            filename: "userB-1.jpg",
            contentType: "image/jpeg",
        });

        const responseB1 = await injectUpload(app, formB1, userB);
        expect(responseB1.statusCode).toBe(200);

        const allUploads = await tester.getDrizzle().select().from(wallpapers);
        expect(allUploads.length).toBe(16);
    });

    it("should reset rate limit after time window expires", async () => {
        const userId = `user_reset_test_${++testIdCounter}`;
        const app = tester.getApp();

        for (let i = 0; i < 15; i++) {
            const testImage = await createTestImage({
                width: 1920,
                height: 1080,
                format: "jpeg",
                color: { r: 90 + i, g: 90 + i, b: 90 + i },
            });
            const form = new FormData();
            form.append("file", testImage, {
                filename: `test-${i}.jpg`,
                contentType: "image/jpeg",
            });

            const response = await injectUpload(app, form, userId);
            expect(response.statusCode).toBe(200);
        }

        const testImageExceed = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
            color: { r: 100, g: 100, b: 100 },
        });
        const formExceed = new FormData();
        formExceed.append("file", testImageExceed, {
            filename: "test-exceed.jpg",
            contentType: "image/jpeg",
        });

        const responseExceed = await injectUpload(app, formExceed, userId);
        expect(responseExceed.statusCode).toBe(429);

        await new Promise((resolve) => setTimeout(resolve, 5500));

        const testImageAfterReset = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
            color: { r: 110, g: 110, b: 110 },
        });
        const formAfterReset = new FormData();
        formAfterReset.append("file", testImageAfterReset, {
            filename: "test-after-reset.jpg",
            contentType: "image/jpeg",
        });

        const responseAfterReset = await injectUpload(app, formAfterReset, userId);
        expect(responseAfterReset.statusCode).toBe(200);
    });

    it("should include rate limit headers in responses", async () => {
        const userId = `user_headers_test_${++testIdCounter}`;
        const testImage = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
            color: { r: 120, g: 120, b: 120 },
        });

        const form = new FormData();
        form.append("file", testImage, {
            filename: "test-headers.jpg",
            contentType: "image/jpeg",
        });

        const response = await injectUpload(tester.getApp(), form, userId);
        expect(response.statusCode).toBe(200);

        expect(response.headers["x-ratelimit-limit"]).toBeDefined();
        expect(response.headers["x-ratelimit-remaining"]).toBeDefined();
        expect(response.headers["x-ratelimit-reset"]).toBeDefined();

        expect(Number(response.headers["x-ratelimit-limit"])).toBe(15);
        expect(Number(response.headers["x-ratelimit-remaining"])).toBeLessThan(15);
    });

    it("should not rate limit health and ready endpoints", async () => {
        const userId = `user_health_test_${++testIdCounter}`;
        const app = tester.getApp();

        for (let i = 0; i < 15; i++) {
            const testImage = await createTestImage({
                width: 1920,
                height: 1080,
                format: "jpeg",
                color: { r: 130 + i, g: 130 + i, b: 130 + i },
            });
            const form = new FormData();
            form.append("file", testImage, {
                filename: `test-${i}.jpg`,
                contentType: "image/jpeg",
            });

            await injectUpload(app, form, userId);
        }

        const testImageExceed = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
            color: { r: 140, g: 140, b: 140 },
        });
        const formExceed = new FormData();
        formExceed.append("file", testImageExceed, {
            filename: "test-exceed.jpg",
            contentType: "image/jpeg",
        });

        const uploadResponse = await injectUpload(app, formExceed, userId);
        expect(uploadResponse.statusCode).toBe(429);

        for (let i = 0; i < 50; i++) {
            const healthResponse = await app.inject({ method: "GET", url: "/health" });
            expect(healthResponse.statusCode).toBe(200);

            const readyResponse = await app.inject({ method: "GET", url: "/ready" });
            expect(readyResponse.statusCode).toBe(200);
        }
    });

    it("should include Retry-After header when rate limited", async () => {
        const userId = `user_retry_after_test_${++testIdCounter}`;
        const app = tester.getApp();

        for (let i = 0; i < 15; i++) {
            const testImage = await createTestImage({
                width: 1920,
                height: 1080,
                format: "jpeg",
                color: { r: 150 + i, g: 150 + i, b: 150 + i },
            });
            const form = new FormData();
            form.append("file", testImage, {
                filename: `test-${i}.jpg`,
                contentType: "image/jpeg",
            });

            await injectUpload(app, form, userId);
        }

        const testImageExceed = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
            color: { r: 160, g: 160, b: 160 },
        });
        const form = new FormData();
        form.append("file", testImageExceed, {
            filename: "test-exceed.jpg",
            contentType: "image/jpeg",
        });

        const response = await injectUpload(app, form, userId);

        expect(response.statusCode).toBe(429);
        expect(response.headers["retry-after"]).toBeDefined();

        const retryAfter = Number(response.headers["retry-after"]);
        expect(retryAfter).toBeGreaterThan(0);
        expect(retryAfter).toBeLessThanOrEqual(5);
    });
});
