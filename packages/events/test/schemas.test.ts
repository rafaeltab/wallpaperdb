import { describe, expect, it } from "vitest";
import {
    WALLPAPER_UPLOADED_SUBJECT,
    WALLPAPER_VARIANT_AVAILABLE_SUBJECT,
    WallpaperUploadedEventSchema,
    type WallpaperVariantAvailableEvent,
    WallpaperVariantAvailableEventSchema,
} from "../src/schemas/index.js";

describe("Event Schemas", () => {
    describe("WallpaperUploadedEventSchema", () => {
        const validEvent = {
            eventId: "evt_01HXYZ123456789",
            eventType: "wallpaper.uploaded" as const,
            timestamp: new Date().toISOString(),
            wallpaper: {
                id: "wlpr_01HXYZ123456789",
                userId: "user_123",
                fileType: "image" as const,
                mimeType: "image/jpeg",
                fileSizeBytes: 1024000,
                width: 1920,
                height: 1080,
                aspectRatio: 1920 / 1080,
                storageKey: "wlpr_01HXYZ123456789/original.jpg",
                storageBucket: "wallpapers",
                originalFilename: "my-wallpaper.jpg",
                uploadedAt: new Date().toISOString(),
            },
        };

        it("should validate a correct event", () => {
            const result = WallpaperUploadedEventSchema.safeParse(validEvent);
            expect(result.success).toBe(true);
        });

        it("should reject event with wrong eventType", () => {
            const invalid = { ...validEvent, eventType: "wrong.type" };
            const result = WallpaperUploadedEventSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });

        it("should reject event with missing eventId", () => {
            const { eventId: _eventId, ...invalid } = validEvent;
            const result = WallpaperUploadedEventSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });

        it("should reject event with invalid fileType", () => {
            const invalid = {
                ...validEvent,
                wallpaper: { ...validEvent.wallpaper, fileType: "audio" },
            };
            const result = WallpaperUploadedEventSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });

        it("should reject event with negative dimensions", () => {
            const invalid = {
                ...validEvent,
                wallpaper: { ...validEvent.wallpaper, width: -100 },
            };
            const result = WallpaperUploadedEventSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });

        it("should reject event with invalid timestamp", () => {
            const invalid = { ...validEvent, timestamp: "not-a-date" };
            const result = WallpaperUploadedEventSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });

        it("should accept video fileType", () => {
            const videoEvent = {
                ...validEvent,
                wallpaper: { ...validEvent.wallpaper, fileType: "video" as const },
            };
            const result = WallpaperUploadedEventSchema.safeParse(videoEvent);
            expect(result.success).toBe(true);
        });
    });

    describe("WALLPAPER_UPLOADED_SUBJECT", () => {
        it("should have the correct subject name", () => {
            expect(WALLPAPER_UPLOADED_SUBJECT).toBe("wallpaper.uploaded");
        });
    });

    describe("WallpaperVariantAvailableEventSchema", () => {
        const validEvent = {
            eventId: "evt_01HXYZ987654321",
            eventType: "wallpaper.variant.available" as const,
            timestamp: new Date().toISOString(),
            variant: {
                wallpaperId: "wlpr_01HXYZ123456789",
                width: 1920,
                height: 1080,
                aspectRatio: 1920 / 1080,
                format: "image/webp" as const,
                fileSizeBytes: 500000,
                createdAt: new Date().toISOString(),
            },
        } satisfies WallpaperVariantAvailableEvent;

        it("should validate a correct event", () => {
            const result = WallpaperVariantAvailableEventSchema.safeParse(validEvent);
            expect(result.success).toBe(true);
        });

        it("should reject event with wrong eventType", () => {
            const invalid = { ...validEvent, eventType: "wrong.type" };
            const result = WallpaperVariantAvailableEventSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });

        it("should reject event without aspectRatio", () => {
            const invalid = {
                ...validEvent,
                variant: { ...validEvent.variant, aspectRatio: undefined },
            };
            const result = WallpaperVariantAvailableEventSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });

        it("should reject event with invalid format", () => {
            const invalid = {
                ...validEvent,
                variant: { ...validEvent.variant, format: "bmp" },
            };
            const result = WallpaperVariantAvailableEventSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });

        it("should accept all valid formats", () => {
            const formats = ["image/jpeg", "image/png", "image/webp"] as const;

            for (const format of formats) {
                const event = {
                    ...validEvent,
                    variant: { ...validEvent.variant, format },
                };
                const result = WallpaperVariantAvailableEventSchema.safeParse(event);
                expect(result.success).toBe(true);
            }
        });

        it("should reject event with negative dimensions", () => {
            const invalid = {
                ...validEvent,
                variant: { ...validEvent.variant, width: -100 },
            };
            const result = WallpaperVariantAvailableEventSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });

        it("should reject event with zero aspect ratio", () => {
            const invalid = {
                ...validEvent,
                variant: { ...validEvent.variant, aspectRatio: 0 },
            };
            const result = WallpaperVariantAvailableEventSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });
    });

    describe("WALLPAPER_VARIANT_AVAILABLE_SUBJECT", () => {
        it("should have the correct subject name", () => {
            expect(WALLPAPER_VARIANT_AVAILABLE_SUBJECT).toBe(
                "wallpaper.variant.available",
            );
        });
    });
});
