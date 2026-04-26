import "reflect-metadata";
import {
    createDefaultTesterBuilder,
    DockerTesterBuilder,
    MinioTesterBuilder,
    NatsTesterBuilder,
    PostgresTesterBuilder,
    RedisTesterBuilder,
} from "@wallpaperdb/test-utils";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import FormData from "form-data";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import {
    IngestorDrizzleTesterBuilder,
    IngestorMigrationsTesterBuilder,
    InProcessIngestorTesterBuilder,
} from "./builders/index.js";
import { createTestImage } from "./fixtures.js";
import { createTestLogger } from "@wallpaperdb/test-logger";

const logger = createTestLogger("rate-limiting-distributed");

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

describe("Multi-Instance Rate Limiting", () => {
    const setup = () => {
        const TesterClass = createDefaultTesterBuilder()
            .with(DockerTesterBuilder)
            .with(PostgresTesterBuilder)
            .with(MinioTesterBuilder)
            .with(NatsTesterBuilder)
            .with(RedisTesterBuilder)
            .with(IngestorDrizzleTesterBuilder)
            .with(IngestorMigrationsTesterBuilder)
            .with(InProcessIngestorTesterBuilder)
            .build();

        const tester = new TesterClass();

        tester
            .withPostgres((builder) =>
                builder.withDatabase(`test_ratelimit_distributed_${Date.now()}`),
            )
            .withMinio()
            .withMinioBucket("wallpapers")
            .withMinioAutoCleanup()
            .withNats((builder) => builder.withJetstream())
            .withStream("WALLPAPER")
            .withNatsAutoCleanup()
            .withRedis()
            .withMigrations()
            .withIngestorEnvironment();
        return tester;
    };

    let tester: ReturnType<typeof setup>;
    let app1: FastifyInstance;
    let app2: FastifyInstance;
    let app3: FastifyInstance;

    beforeAll(async () => {
        tester = setup();
        await tester.setup();

        logger.debug("Starting app instances...");

        const config = loadConfig();

        const config1 = { ...config, port: 0 };
        const config2 = { ...config, port: 0 };
        const config3 = { ...config, port: 0 };

        app1 = await createApp(config1, { logger: false, enableOtel: false });
        app2 = await createApp(config2, { logger: false, enableOtel: false });
        app3 = await createApp(config3, { logger: false, enableOtel: false });

        await app1.ready();
        await app2.ready();
        await app3.ready();

        logger.debug("All instances started");
    }, 120000);

    afterAll(async () => {
        await app1.close();
        await app2.close();
        await app3.close();
        await tester.destroy();
    });

    it("should enforce rate limit across all instances (not per-instance)", async () => {
        const userId = "user_distributed_test";

        const requests: Promise<LightMyRequestResponse>[] = [];

        for (let i = 0; i < 10; i++) {
            const testImage = await createTestImage({
                width: 1920,
                height: 1080,
                format: "jpeg",
                color: { r: 100 + i, g: 100 + i, b: 100 + i },
            });

            const form = new FormData();
            form.append("file", testImage, {
                filename: `test-${i}.jpg`,
                contentType: "image/jpeg",
            });

            const app = [app1, app2, app3][i % 3];
            requests.push(injectUpload(app, form, userId));
        }

        const responses = await Promise.all(requests);

        const successCount = responses.filter((r) => r.statusCode === 200).length;
        expect(successCount).toBe(10);

        const testImage11 = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
            color: { r: 111, g: 111, b: 111 },
        });
        const form11 = new FormData();
        form11.append("file", testImage11, {
            filename: "test-11.jpg",
            contentType: "image/jpeg",
        });

        const response11 = await injectUpload(app1, form11, userId);
        expect(response11.statusCode).toBe(429);

        const body = JSON.parse(response11.body);
        expect(body.type).toBe("https://wallpaperdb.example/problems/rate-limit-exceeded");
        expect(body.status).toBe(429);
        expect(body.retryAfter).toBeDefined();
    });

    it("should share rate limit counter across instances", async () => {
        const userId = "user_counter_test";

        for (let i = 0; i < 5; i++) {
            const testImage = await createTestImage({
                width: 1920,
                height: 1080,
                format: "jpeg",
                color: { r: 50 + i, g: 50 + i, b: 50 + i },
            });
            const form = new FormData();
            form.append("file", testImage, {
                filename: `app1-${i}.jpg`,
                contentType: "image/jpeg",
            });

            const response = await injectUpload(app1, form, userId);
            expect(response.statusCode).toBe(200);

            expect(response.headers["x-ratelimit-limit"]).toBe("10");
            expect(Number(response.headers["x-ratelimit-remaining"])).toBe(10 - (i + 1));
        }

        for (let i = 0; i < 5; i++) {
            const testImage = await createTestImage({
                width: 1920,
                height: 1080,
                format: "jpeg",
                color: { r: 60 + i, g: 60 + i, b: 60 + i },
            });
            const form = new FormData();
            form.append("file", testImage, {
                filename: `app2-${i}.jpg`,
                contentType: "image/jpeg",
            });

            const response = await injectUpload(app2, form, userId);
            expect(response.statusCode).toBe(200);
        }

        const testImage11 = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
            color: { r: 70, g: 70, b: 70 },
        });
        const form11 = new FormData();
        form11.append("file", testImage11, {
            filename: "app3-exceed.jpg",
            contentType: "image/jpeg",
        });

        const response11 = await injectUpload(app3, form11, userId);
        expect(response11.statusCode).toBe(429);
        expect(response11.headers["x-ratelimit-remaining"]).toBe("0");
    });

    it("should isolate rate limits per user across instances", async () => {
        for (let i = 0; i < 10; i++) {
            const testImage = await createTestImage({
                width: 1920,
                height: 1080,
                format: "jpeg",
                color: { r: 80 + i, g: 80 + i, b: 80 + i },
            });
            const form = new FormData();
            form.append("file", testImage, {
                filename: `userA-${i}.jpg`,
                contentType: "image/jpeg",
            });

            await injectUpload(app1, form, "user_a_isolated");
        }

        const testImageA11 = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
            color: { r: 90, g: 90, b: 90 },
        });
        const formA11 = new FormData();
        formA11.append("file", testImageA11, {
            filename: "userA-exceed.jpg",
            contentType: "image/jpeg",
        });

        const responseA11 = await injectUpload(app2, formA11, "user_a_isolated");
        expect(responseA11.statusCode).toBe(429);

        const testImageB1 = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
            color: { r: 95, g: 95, b: 95 },
        });
        const formB1 = new FormData();
        formB1.append("file", testImageB1, {
            filename: "userB-1.jpg",
            contentType: "image/jpeg",
        });

        const responseB1 = await injectUpload(app3, formB1, "user_b_isolated");
        expect(responseB1.statusCode).toBe(200);
    });

    it("should reset rate limit after time window expires", async () => {
        const userId = "user_reset_test";

        for (let i = 0; i < 10; i++) {
            const testImage = await createTestImage({
                width: 1920,
                height: 1080,
                format: "jpeg",
                color: { r: 120 + i, g: 120 + i, b: 120 + i },
            });
            const form = new FormData();
            form.append("file", testImage, {
                filename: `test-${i}.jpg`,
                contentType: "image/jpeg",
            });

            const app = [app1, app2, app3][i % 3];
            await injectUpload(app, form, userId);
        }

        const testImageExceed = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
            color: { r: 130, g: 130, b: 130 },
        });
        const formExceed = new FormData();
        formExceed.append("file", testImageExceed, {
            filename: "test-exceed.jpg",
            contentType: "image/jpeg",
        });

        const responseExceed = await injectUpload(app1, formExceed, userId);
        expect(responseExceed.statusCode).toBe(429);

        logger.debug("Waiting for rate limit window to expire...");
        await new Promise((resolve) => setTimeout(resolve, 11000));

        const testImageAfterReset = await createTestImage({
            width: 1920,
            height: 1080,
            format: "jpeg",
            color: { r: 140, g: 140, b: 140 },
        });
        const formAfterReset = new FormData();
        formAfterReset.append("file", testImageAfterReset, {
            filename: "test-after-reset.jpg",
            contentType: "image/jpeg",
        });

        const responseAfterReset = await injectUpload(app2, formAfterReset, userId);
        expect(responseAfterReset.statusCode).toBe(200);
    }, 30000);
});
