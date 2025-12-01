import "reflect-metadata";
import { Client } from "@opensearch-project/opensearch";
import {
    createDefaultTesterBuilder,
    DockerTesterBuilder,
    NatsTesterBuilder,
    OpenSearchTesterBuilder,
} from "@wallpaperdb/test-utils";
import { container } from "tsyringe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WallpaperRepository } from "../../src/repositories/wallpaper.repository.js";
import { InProcessGatewayTesterBuilder } from "../builders/InProcessGatewayBuilder.js";

describe("OpenSearch Integration", () => {
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
    let repository: WallpaperRepository;
    let client: Client;

    beforeAll(async () => {
        tester = setup();
        await tester.setup();
        repository = container.resolve(WallpaperRepository);
        client = new Client({
            node: `http://${tester.opensearch.config.host.fromHost}:${tester.opensearch.config.port.fromHost}`,
        });
    }, 60000);

    afterAll(async () => {
        await tester.destroy();
    });

    describe("IndexManagerService", () => {
        it("should create the wallpapers index", async () => {
            const exists = await client.indices.exists({
                index: "wallpapers",
            });

            expect(exists.body).toBe(true);
        });
    });

    describe("WallpaperRepository", () => {
        it("should upsert a wallpaper document", async () => {
            await repository.upsert({
                wallpaperId: "wlpr_test_001",
                userId: "user_001",
                variants: [],
                uploadedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            const doc = await repository.findById("wlpr_test_001");
            expect(doc).not.toBeNull();
            expect(doc?.wallpaperId).toBe("wlpr_test_001");
            expect(doc?.userId).toBe("user_001");
            expect(doc?.variants).toEqual([]);
        });

        it("should add a variant to a wallpaper", async () => {
            // Create wallpaper
            await repository.upsert({
                wallpaperId: "wlpr_test_002",
                userId: "user_001",
                variants: [],
                uploadedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            // Add variant
            await repository.addVariant("wlpr_test_002", {
                width: 1920,
                height: 1080,
                aspectRatio: 1920 / 1080,
                format: "jpeg",
                fileSizeBytes: 500000,
                createdAt: new Date().toISOString(),
            });

            const doc = await repository.findById("wlpr_test_002");
            expect(doc?.variants).toHaveLength(1);
            expect(doc?.variants[0].width).toBe(1920);
            expect(doc?.variants[0].height).toBe(1080);
            expect(doc?.variants[0].format).toBe("jpeg");
        });

        it("should return null for non-existent wallpaper", async () => {
            const doc = await repository.findById("wlpr_nonexistent");
            expect(doc).toBeNull();
        });

        it("should search wallpapers by userId", async () => {
            // Create test documents
            await repository.upsert({
                wallpaperId: "wlpr_test_003",
                userId: "user_002",
                variants: [],
                uploadedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            await repository.upsert({
                wallpaperId: "wlpr_test_004",
                userId: "user_002",
                variants: [],
                uploadedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            await repository.upsert({
                wallpaperId: "wlpr_test_005",
                userId: "user_003",
                variants: [],
                uploadedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            // Search by userId
            const result = await repository.search({ userId: "user_002" });
            expect(result.total).toBeGreaterThanOrEqual(2);
            expect(result.documents.every((doc) => doc.userId === "user_002")).toBe(
                true,
            );
        });

        it("should search wallpapers by variant dimensions", async () => {
            // Create wallpaper with specific variant
            await repository.upsert({
                wallpaperId: "wlpr_test_006",
                userId: "user_004",
                variants: [
                    {
                        width: 2560,
                        height: 1440,
                        aspectRatio: 2560 / 1440,
                        format: "webp",
                        fileSizeBytes: 600000,
                        createdAt: new Date().toISOString(),
                    },
                ],
                uploadedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            // Search by variant width
            const result = await repository.search({
                variantFilters: { width: 2560 },
            });

            expect(result.total).toBeGreaterThanOrEqual(1);
            const found = result.documents.find(
                (doc) => doc.wallpaperId === "wlpr_test_006",
            );
            expect(found).toBeDefined();
        });

        it("should search wallpapers by variant format", async () => {
            // Create wallpaper with PNG variant
            await repository.upsert({
                wallpaperId: "wlpr_test_007",
                userId: "user_004",
                variants: [
                    {
                        width: 1920,
                        height: 1080,
                        aspectRatio: 1920 / 1080,
                        format: "png",
                        fileSizeBytes: 800000,
                        createdAt: new Date().toISOString(),
                    },
                ],
                uploadedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            // Search by format
            const result = await repository.search({
                variantFilters: { format: "png" },
            });

            expect(result.total).toBeGreaterThanOrEqual(1);
            const found = result.documents.find(
                (doc) => doc.wallpaperId === "wlpr_test_007",
            );
            expect(found).toBeDefined();
        });

        it("should combine userId and variant filters", async () => {
            // Create wallpaper
            await repository.upsert({
                wallpaperId: "wlpr_test_008",
                userId: "user_005",
                variants: [
                    {
                        width: 3840,
                        height: 2160,
                        aspectRatio: 3840 / 2160,
                        format: "jpeg",
                        fileSizeBytes: 1200000,
                        createdAt: new Date().toISOString(),
                    },
                ],
                uploadedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            // Search by userId AND variant width
            const result = await repository.search({
                userId: "user_005",
                variantFilters: { width: 3840 },
            });

            expect(result.total).toBeGreaterThanOrEqual(1);
            const found = result.documents.find(
                (doc) => doc.wallpaperId === "wlpr_test_008",
            );
            expect(found).toBeDefined();
        });

        it("should return empty results for non-matching filters", async () => {
            const result = await repository.search({
                userId: "user_nonexistent",
            });

            expect(result.total).toBe(0);
            expect(result.documents).toEqual([]);
        });
    });
});
