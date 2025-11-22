import { describe, it, expect } from "vitest";
import {
  WallpaperUploadedEventSchema,
  WALLPAPER_UPLOADED_SUBJECT,
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
});
