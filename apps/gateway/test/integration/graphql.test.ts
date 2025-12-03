import "reflect-metadata";
import {
    createDefaultTesterBuilder,
    DockerTesterBuilder,
    NatsTesterBuilder,
    OpenSearchTesterBuilder,
} from "@wallpaperdb/test-utils";
import type { FastifyInstance } from "fastify";
import { container } from "tsyringe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WallpaperRepository } from "../../src/repositories/wallpaper.repository.js";
import { InProcessGatewayTesterBuilder } from "../builders/InProcessGatewayBuilder.js";

describe("GraphQL API Integration", () => {
    const setup = () => {
        process.env.MEDIA_SERVICE_URL = "http://media.example.com";
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
    let app: FastifyInstance;
    let repository: WallpaperRepository;

    beforeAll(async () => {
        tester = setup();
        await tester.setup();
        app = tester.getApp();
        repository = container.resolve(WallpaperRepository);
    }, 60000);

    afterAll(async () => {
        await tester.destroy();
    });

    describe("searchWallpapers Query", () => {
        it("should return empty results when no wallpapers exist", async () => {
            const query = `
				query {
					searchWallpapers {
						edges {
							node {
								wallpaperId
								userId
							}
						}
						pageInfo {
							hasNextPage
							hasPreviousPage
							startCursor
							endCursor
						}
					}
				}
			`;

            const response = await app.inject({
                method: "POST",
                url: "/graphql",
                headers: {
                    "content-type": "application/json",
                },
                payload: JSON.stringify({ query }),
            });

            expect(response.statusCode).toBe(200);
            const result = JSON.parse(response.body);
            expect(result.data.searchWallpapers.edges).toEqual([]);
            expect(result.data.searchWallpapers.pageInfo.hasNextPage).toBe(false);
        });

        it("should search wallpapers by userId", async () => {
            // Create test data
            await repository.upsert({
                wallpaperId: "wlpr_gql_001",
                userId: "user_gql_001",
                variants: [],
                uploadedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            await repository.upsert({
                wallpaperId: "wlpr_gql_002",
                userId: "user_gql_002",
                variants: [],
                uploadedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            const query = `
				query {
					searchWallpapers(filter: { userId: "user_gql_001" }) {
						edges {
							node {
								wallpaperId
								userId
							}
						}
					}
				}
			`;

            const response = await app.inject({
                method: "POST",
                url: "/graphql",
                headers: {
                    "content-type": "application/json",
                },
                payload: JSON.stringify({ query }),
            });

            expect(response.statusCode).toBe(200);
            const result = JSON.parse(response.body);
            expect(result.data.searchWallpapers.edges).toHaveLength(1);
            expect(result.data.searchWallpapers.edges[0].node.wallpaperId).toBe(
                "wlpr_gql_001",
            );
            expect(result.data.searchWallpapers.edges[0].node.userId).toBe(
                "user_gql_001",
            );
        });

        it("should search wallpapers by variant width", async () => {
            // Create wallpaper with specific variant
            await repository.upsert({
                wallpaperId: "wlpr_gql_003",
                userId: "user_gql_003",
                variants: [
                    {
                        width: 1920,
                        height: 1080,
                        aspectRatio: 1920 / 1080,
                        format: "image/jpeg",
                        fileSizeBytes: 500000,
                        createdAt: new Date().toISOString(),
                    },
                ],
                uploadedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            const query = `
				query {
					searchWallpapers(filter: { variants: { width: 1920 } }) {
						edges {
							node {
								wallpaperId
								variants {
									width
									height
									format
								}
							}
						}
					}
				}
			`;

            const response = await app.inject({
                method: "POST",
                url: "/graphql",
                headers: {
                    "content-type": "application/json",
                },
                payload: JSON.stringify({ query }),
            });

            expect(response.statusCode).toBe(200);
            const result = JSON.parse(response.body);
            expect(result.data.searchWallpapers.edges.length).toBeGreaterThan(0);
            const found = result.data.searchWallpapers.edges.find(
                (edge: any) => edge.node.wallpaperId === "wlpr_gql_003",
            );
            expect(found).toBeDefined();
            expect(found.node.variants[0].width).toBe(1920);
        });

        it("should return variant URLs with MEDIA_SERVICE_URL", async () => {
            // Environment variable set in the setup

            await repository.upsert({
                wallpaperId: "wlpr_gql_004",
                userId: "user_gql_004",
                variants: [
                    {
                        width: 2560,
                        height: 1440,
                        aspectRatio: 2560 / 1440,
                        format: "image/webp",
                        fileSizeBytes: 600000,
                        createdAt: new Date().toISOString(),
                    },
                ],
                uploadedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            const query = `
				query {
					searchWallpapers(filter: { userId: "user_gql_004" }) {
						edges {
							node {
								wallpaperId
								variants {
									width
									height
									format
									url
								}
							}
						}
					}
				}
			`;

            const response = await app.inject({
                method: "POST",
                url: "/graphql",
                headers: {
                    "content-type": "application/json",
                },
                payload: JSON.stringify({ query }),
            });

            expect(response.statusCode).toBe(200);
            const result = JSON.parse(response.body);
            const variant = result.data.searchWallpapers.edges[0].node.variants[0];
            expect(variant.url).toBe(
                `${process.env.MEDIA_SERVICE_URL}/wallpapers/wlpr_gql_004?w=2560&h=1440&format=image/webp`,
            );
        });

        it("should support pagination with first/after", async () => {
            // Create multiple wallpapers
            for (let i = 0; i < 5; i++) {
                await repository.upsert({
                    wallpaperId: `wlpr_gql_page_${i}`,
                    userId: "user_gql_pagination",
                    variants: [],
                    uploadedAt: new Date().toISOString(),
                    updatedAt: new Date().toISOString(),
                });
            }

            // Get first page
            const query1 = `
				query {
					searchWallpapers(filter: { userId: "user_gql_pagination" }, first: 2) {
						edges {
							node {
								wallpaperId
							}
						}
						pageInfo {
							hasNextPage
							endCursor
						}
					}
				}
			`;

            const response1 = await app.inject({
                method: "POST",
                url: "/graphql",
                headers: {
                    "content-type": "application/json",
                },
                payload: JSON.stringify({ query: query1 }),
            });

            expect(response1.statusCode).toBe(200);
            const result1 = JSON.parse(response1.body);
            expect(result1.data.searchWallpapers.edges).toHaveLength(2);
            expect(result1.data.searchWallpapers.pageInfo.hasNextPage).toBe(true);

            const cursor = result1.data.searchWallpapers.pageInfo.endCursor;

            // Get second page
            const query2 = `
				query {
					searchWallpapers(
						filter: { userId: "user_gql_pagination" }
						first: 2
						after: "${cursor}"
					) {
						edges {
							node {
								wallpaperId
							}
						}
						pageInfo {
							hasNextPage
							hasPreviousPage
						}
					}
				}
			`;

            const response2 = await app.inject({
                method: "POST",
                url: "/graphql",
                headers: {
                    "content-type": "application/json",
                },
                payload: JSON.stringify({ query: query2 }),
            });

            expect(response2.statusCode).toBe(200);
            const result2 = JSON.parse(response2.body);
            expect(result2.data.searchWallpapers.edges).toHaveLength(2);
            expect(result2.data.searchWallpapers.pageInfo.hasPreviousPage).toBe(true);
        });

        it("should combine userId and variant filters", async () => {
            await repository.upsert({
                wallpaperId: "wlpr_gql_005",
                userId: "user_gql_005",
                variants: [
                    {
                        width: 3840,
                        height: 2160,
                        aspectRatio: 3840 / 2160,
                        format: "image/png",
                        fileSizeBytes: 1200000,
                        createdAt: new Date().toISOString(),
                    },
                ],
                uploadedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            const query = `
				query {
					searchWallpapers(
						filter: {
							userId: "user_gql_005"
							variants: { width: 3840, format: "image/png" }
						}
					) {
						edges {
							node {
								wallpaperId
								userId
								variants {
									width
									format
								}
							}
						}
					}
				}
			`;

            const response = await app.inject({
                method: "POST",
                url: "/graphql",
                headers: {
                    "content-type": "application/json",
                },
                payload: JSON.stringify({ query }),
            });

            expect(response.statusCode).toBe(200);
            const result = JSON.parse(response.body);
            console.log(result);
            expect(result.data.searchWallpapers.edges).toHaveLength(1);
            expect(result.data.searchWallpapers.edges[0].node.wallpaperId).toBe(
                "wlpr_gql_005",
            );
        });
    });
});
