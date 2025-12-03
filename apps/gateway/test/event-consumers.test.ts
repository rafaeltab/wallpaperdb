import "reflect-metadata";
import {
    WALLPAPER_UPLOADED_SUBJECT,
    WALLPAPER_VARIANT_AVAILABLE_SUBJECT,
    type WallpaperUploadedEvent,
    type WallpaperVariantAvailableEvent,
} from "@wallpaperdb/events";
import { container } from "tsyringe";
import { describe, expect, it } from "vitest";
import { WallpaperRepository } from "../src/repositories/wallpaper.repository.js";
import { tester } from "./setup.js";

describe("Event Consumers Integration", () => {
    describe("WallpaperUploadedConsumer", () => {
        it("should create wallpaper document when receiving wallpaper.uploaded event", async () => {
            const event: WallpaperUploadedEvent = {
                eventId: "evt_001",
                eventType: "wallpaper.uploaded",
                timestamp: new Date().toISOString(),
                wallpaper: {
                    id: "wlpr_consumer_001",
                    userId: "user_001",
                    fileType: "image",
                    mimeType: "image/jpeg",
                    fileSizeBytes: 1024000,
                    width: 1920,
                    height: 1080,
                    aspectRatio: 1920 / 1080,
                    storageKey: "wlpr_consumer_001/original.jpg",
                    storageBucket: "wallpapers",
                    originalFilename: "test.jpg",
                    uploadedAt: new Date().toISOString(),
                },
            };

            // Publish event
            await tester.nats.publishEvent(WALLPAPER_UPLOADED_SUBJECT, event);

            // Wait for event to be processed
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Verify document was created
            const doc = await container.resolve(WallpaperRepository).findById("wlpr_consumer_001");
            expect(doc).not.toBeNull();
            expect(doc?.wallpaperId).toBe("wlpr_consumer_001");
            expect(doc?.userId).toBe("user_001");
            expect(doc?.variants).toEqual([]);
        });

        it("should be idempotent (handle duplicate events)", async () => {
            const event: WallpaperUploadedEvent = {
                eventId: "evt_002",
                eventType: "wallpaper.uploaded",
                timestamp: new Date().toISOString(),
                wallpaper: {
                    id: "wlpr_consumer_002",
                    userId: "user_002",
                    fileType: "image",
                    mimeType: "image/png",
                    fileSizeBytes: 2048000,
                    width: 2560,
                    height: 1440,
                    aspectRatio: 2560 / 1440,
                    storageKey: "wlpr_consumer_002/original.png",
                    storageBucket: "wallpapers",
                    originalFilename: "test.png",
                    uploadedAt: new Date().toISOString(),
                },
            };

            // Publish event twice
            await tester.nats.publishEvent(WALLPAPER_UPLOADED_SUBJECT, event);
            await tester.nats.publishEvent(WALLPAPER_UPLOADED_SUBJECT, event);

            // Wait for events to be processed
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Verify document exists and wasn't duplicated
            const doc = await container.resolve(WallpaperRepository).findById("wlpr_consumer_002");
            expect(doc).not.toBeNull();
            expect(doc?.wallpaperId).toBe("wlpr_consumer_002");
        });
    });

    describe("WallpaperVariantAvailableConsumer", () => {
        it("should add variant to wallpaper when receiving variant.available event", async () => {
            // First, create a wallpaper
            const uploadEvent: WallpaperUploadedEvent = {
                eventId: "evt_003",
                eventType: "wallpaper.uploaded",
                timestamp: new Date().toISOString(),
                wallpaper: {
                    id: "wlpr_consumer_003",
                    userId: "user_003",
                    fileType: "image",
                    mimeType: "image/webp",
                    fileSizeBytes: 512000,
                    width: 3840,
                    height: 2160,
                    aspectRatio: 3840 / 2160,
                    storageKey: "wlpr_consumer_003/original.webp",
                    storageBucket: "wallpapers",
                    originalFilename: "test.webp",
                    uploadedAt: new Date().toISOString(),
                },
            };

            await tester.nats.publishEvent(WALLPAPER_UPLOADED_SUBJECT, uploadEvent);

            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Now publish variant.available event
            const variantEvent: WallpaperVariantAvailableEvent = {
                eventId: "evt_004",
                eventType: "wallpaper.variant.available",
                timestamp: new Date().toISOString(),
                variant: {
                    wallpaperId: "wlpr_consumer_003",
                    width: 1920,
                    height: 1080,
                    aspectRatio: 1920 / 1080,
                    format: "image/jpeg",
                    fileSizeBytes: 500000,
                    createdAt: new Date().toISOString(),
                },
            };

            await tester.nats.publishEvent(
                WALLPAPER_VARIANT_AVAILABLE_SUBJECT,
                variantEvent,
            );

            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Verify variant was added
            const doc = await container.resolve(WallpaperRepository).findById("wlpr_consumer_003");
            expect(doc).not.toBeNull();
            expect(doc?.variants).toHaveLength(1);
            expect(doc?.variants[0].width).toBe(1920);
            expect(doc?.variants[0].height).toBe(1080);
            expect(doc?.variants[0].format).toBe("image/jpeg");
        });

        it("should add multiple variants to same wallpaper", async () => {
            // Create wallpaper
            const uploadEvent: WallpaperUploadedEvent = {
                eventId: "evt_005",
                eventType: "wallpaper.uploaded",
                timestamp: new Date().toISOString(),
                wallpaper: {
                    id: "wlpr_consumer_004",
                    userId: "user_004",
                    fileType: "image",
                    mimeType: "image/jpeg",
                    fileSizeBytes: 2048000,
                    width: 3840,
                    height: 2160,
                    aspectRatio: 3840 / 2160,
                    storageKey: "wlpr_consumer_004/original.jpg",
                    storageBucket: "wallpapers",
                    originalFilename: "test.jpg",
                    uploadedAt: new Date().toISOString(),
                },
            };

            await tester.nats.publishEvent(WALLPAPER_UPLOADED_SUBJECT, uploadEvent);

            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Add first variant
            const variant1Event: WallpaperVariantAvailableEvent = {
                eventId: "evt_006",
                eventType: "wallpaper.variant.available",
                timestamp: new Date().toISOString(),
                variant: {
                    wallpaperId: "wlpr_consumer_004",
                    width: 2560,
                    height: 1440,
                    aspectRatio: 2560 / 1440,
                    format: "image/webp",
                    fileSizeBytes: 600000,
                    createdAt: new Date().toISOString(),
                },
            };

            await tester.nats.publishEvent(
                WALLPAPER_VARIANT_AVAILABLE_SUBJECT,
                variant1Event,
            );

            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Add second variant
            const variant2Event: WallpaperVariantAvailableEvent = {
                eventId: "evt_007",
                eventType: "wallpaper.variant.available",
                timestamp: new Date().toISOString(),
                variant: {
                    wallpaperId: "wlpr_consumer_004",
                    width: 1920,
                    height: 1080,
                    aspectRatio: 1920 / 1080,
                    format: "image/png",
                    fileSizeBytes: 800000,
                    createdAt: new Date().toISOString(),
                },
            };

            await tester.nats.publishEvent(
                WALLPAPER_VARIANT_AVAILABLE_SUBJECT,
                variant2Event,
            );

            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Verify both variants were added
            const doc = await container.resolve(WallpaperRepository).findById("wlpr_consumer_004");
            expect(doc).not.toBeNull();
            expect(doc?.variants).toHaveLength(2);
            expect(doc?.variants[0].format).toBe("image/webp");
            expect(doc?.variants[1].format).toBe("image/png");
        });
    });
});
