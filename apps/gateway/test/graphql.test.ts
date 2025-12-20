import "reflect-metadata";
import { container } from "tsyringe";
import { describe, expect, it } from "vitest";
import type { WallpaperDocument } from "../src/repositories/wallpaper.repository.js";
import { WallpaperRepository } from "../src/repositories/wallpaper.repository.js";
import { tester } from "./setup.js";

describe("GraphQL API Integration", () => {
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

            const response = await tester.getApp().inject({
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
            await container.resolve(WallpaperRepository).upsert({
                wallpaperId: "wlpr_gql_001",
                userId: "user_gql_001",
                variants: [],
                uploadedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            });

            await container.resolve(WallpaperRepository).upsert({
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

            const response = await tester.getApp().inject({
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
            await container.resolve(WallpaperRepository).upsert({
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

            const response = await tester.getApp().inject({
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

            await container.resolve(WallpaperRepository).upsert({
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

            const response = await tester.getApp().inject({
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
                await container.resolve(WallpaperRepository).upsert({
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

            const response1 = await tester.getApp().inject({
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

            const response2 = await tester.getApp().inject({
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
            await container.resolve(WallpaperRepository).upsert({
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

            const response = await tester.getApp().inject({
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

    describe("getWallpaper Query", () => {
        describe("successful retrieval", () => {
            it("should return wallpaper by ID with all fields", async () => {
                // Arrange: Create test wallpaper
                const testWallpaper: WallpaperDocument = {
                    wallpaperId: "wlpr_01234567890123456789012345",
                    userId: "user_get_001",
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
                    uploadedAt: "2024-01-15T10:30:00.000Z",
                    updatedAt: "2024-01-15T10:30:00.000Z",
                };

                await container.resolve(WallpaperRepository).upsert(testWallpaper);

                // Act: Query for the wallpaper
                const query = `
					query {
						getWallpaper(wallpaperId: "wlpr_01234567890123456789012345") {
							wallpaperId
							userId
							variants {
								width
								height
								aspectRatio
								format
								fileSizeBytes
								createdAt
								url
							}
							uploadedAt
							updatedAt
						}
					}
				`;

                const response = await tester.getApp().inject({
                    method: "POST",
                    url: "/graphql",
                    headers: { "content-type": "application/json" },
                    payload: JSON.stringify({ query }),
                });

                // Assert: All fields returned correctly
                expect(response.statusCode).toBe(200);
                const result = JSON.parse(response.body);

                expect(result.errors).toBeUndefined();
                expect(result.data.getWallpaper).toBeDefined();
                expect(result.data.getWallpaper).toEqual({
                    wallpaperId: "wlpr_01234567890123456789012345",
                    userId: "user_get_001",
                    variants: [
                        {
                            width: 1920,
                            height: 1080,
                            aspectRatio: 1920 / 1080,
                            format: "image/jpeg",
                            fileSizeBytes: 500000,
                            createdAt: testWallpaper.variants[0].createdAt,
                            url: `${process.env.MEDIA_SERVICE_URL}/wallpapers/wlpr_01234567890123456789012345?w=1920&h=1080&format=image/jpeg`,
                        },
                    ],
                    uploadedAt: "2024-01-15T10:30:00.000Z",
                    updatedAt: "2024-01-15T10:30:00.000Z",
                });
            });

            it("should return wallpaper with multiple variants", async () => {
                // Arrange: Wallpaper with multiple variants
                const testWallpaper: WallpaperDocument = {
                    wallpaperId: "wlpr_multi_variant_001",
                    userId: "user_get_002",
                    variants: [
                        {
                            width: 1920,
                            height: 1080,
                            aspectRatio: 1920 / 1080,
                            format: "image/jpeg",
                            fileSizeBytes: 500000,
                            createdAt: new Date().toISOString(),
                        },
                        {
                            width: 2560,
                            height: 1440,
                            aspectRatio: 2560 / 1440,
                            format: "image/webp",
                            fileSizeBytes: 400000,
                            createdAt: new Date().toISOString(),
                        },
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
                };

                await container.resolve(WallpaperRepository).upsert(testWallpaper);

                // Act
                const query = `
					query {
						getWallpaper(wallpaperId: "wlpr_multi_variant_001") {
							wallpaperId
							variants {
								width
								height
								format
							}
						}
					}
				`;

                const response = await tester.getApp().inject({
                    method: "POST",
                    url: "/graphql",
                    headers: { "content-type": "application/json" },
                    payload: JSON.stringify({ query }),
                });

                // Assert: All three variants present
                expect(response.statusCode).toBe(200);
                const result = JSON.parse(response.body);
                expect(result.data.getWallpaper.variants).toHaveLength(3);
                expect(result.data.getWallpaper.variants).toEqual([
                    { width: 1920, height: 1080, format: "image/jpeg" },
                    { width: 2560, height: 1440, format: "image/webp" },
                    { width: 3840, height: 2160, format: "image/png" },
                ]);
            });

            it("should correctly compute variant URLs", async () => {
                // Arrange
                const testWallpaper: WallpaperDocument = {
                    wallpaperId: "wlpr_url_test_001",
                    userId: "user_get_003",
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
                };

                await container.resolve(WallpaperRepository).upsert(testWallpaper);

                // Act
                const query = `
					query {
						getWallpaper(wallpaperId: "wlpr_url_test_001") {
							variants {
								url
							}
						}
					}
				`;

                const response = await tester.getApp().inject({
                    method: "POST",
                    url: "/graphql",
                    headers: { "content-type": "application/json" },
                    payload: JSON.stringify({ query }),
                });

                // Assert: URL follows correct format
                expect(response.statusCode).toBe(200);
                const result = JSON.parse(response.body);
                expect(result.data.getWallpaper.variants[0].url).toBe(
                    `${process.env.MEDIA_SERVICE_URL}/wallpapers/wlpr_url_test_001?w=2560&h=1440&format=image/webp`,
                );
            });
        });

        describe("not found scenarios", () => {
            it("should return null for non-existent wallpaper ID", async () => {
                // Act: Query for wallpaper that doesn't exist
                const query = `
					query {
						getWallpaper(wallpaperId: "wlpr_nonexistent_123456789012") {
							wallpaperId
							userId
						}
					}
				`;

                const response = await tester.getApp().inject({
                    method: "POST",
                    url: "/graphql",
                    headers: { "content-type": "application/json" },
                    payload: JSON.stringify({ query }),
                });

                // Assert: Returns null (not an error)
                expect(response.statusCode).toBe(200);
                const result = JSON.parse(response.body);
                expect(result.errors).toBeUndefined();
                expect(result.data.getWallpaper).toBeNull();
            });

            it("should return null without throwing when querying optional fields on null result", async () => {
                // Act: Query non-existent wallpaper with nested fields
                const query = `
					query {
						getWallpaper(wallpaperId: "wlpr_does_not_exist") {
							wallpaperId
							userId
							variants {
								width
								url
							}
						}
					}
				`;

                const response = await tester.getApp().inject({
                    method: "POST",
                    url: "/graphql",
                    headers: { "content-type": "application/json" },
                    payload: JSON.stringify({ query }),
                });

                // Assert: Gracefully returns null
                expect(response.statusCode).toBe(200);
                const result = JSON.parse(response.body);
                expect(result.errors).toBeUndefined();
                expect(result.data.getWallpaper).toBeNull();
            });
        });

        describe("input validation", () => {
            it("should return error for empty wallpaperId", async () => {
                // Act: Empty string
                const query = `
					query {
						getWallpaper(wallpaperId: "") {
							wallpaperId
						}
					}
				`;

                const response = await tester.getApp().inject({
                    method: "POST",
                    url: "/graphql",
                    headers: { "content-type": "application/json" },
                    payload: JSON.stringify({ query }),
                });

                // Assert: GraphQL error returned
                expect(response.statusCode).toBe(200);
                const result = JSON.parse(response.body);
                expect(result.errors).toBeDefined();
                expect(result.errors).toHaveLength(1);
                expect(result.errors[0].message).toContain("empty");
            });

            it("should return error for wallpaperId not matching expected format", async () => {
                // Act: Invalid format (doesn't start with wlpr_)
                const query = `
					query {
						getWallpaper(wallpaperId: "invalid-id-format") {
							wallpaperId
						}
					}
				`;

                const response = await tester.getApp().inject({
                    method: "POST",
                    url: "/graphql",
                    headers: { "content-type": "application/json" },
                    payload: JSON.stringify({ query }),
                });

                // Assert: GraphQL error about format
                expect(response.statusCode).toBe(200);
                const result = JSON.parse(response.body);
                expect(result.errors).toBeDefined();
                expect(result.errors).toHaveLength(1);
                expect(result.errors[0].message).toContain("wlpr_");
            });

            it("should return error when wallpaperId argument is missing", async () => {
                // Act: Query without the required argument
                const query = `
					query {
						getWallpaper {
							wallpaperId
						}
					}
				`;

                const response = await tester.getApp().inject({
                    method: "POST",
                    url: "/graphql",
                    headers: { "content-type": "application/json" },
                    payload: JSON.stringify({ query }),
                });

                // Assert: GraphQL schema validation error
                expect(response.statusCode).toBe(400);
                const result = JSON.parse(response.body);
                expect(result.errors).toBeDefined();
            });
        });
    });
});
