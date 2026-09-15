import { describe, expect, it } from "vitest";
import {
  WALLPAPER_UPLOADED_SUBJECT,
  WALLPAPER_VARIANT_AVAILABLE_SUBJECT,
  WALLPAPER_COLORS_EXTRACTED_SUBJECT,
  WallpaperUploadedEventSchema,
  type WallpaperVariantAvailableEvent,
  WallpaperVariantAvailableEventSchema,
  WallpaperColorsExtractedEventSchema,
  PROFILE_CREATED_SUBJECT,
  ProfileCreatedEventSchema,
  PROFILE_UPDATED_SUBJECT,
  ProfileUpdatedEventSchema,
} from "../src/schemas/index.js";

describe("Event Schemas", () => {
  describe("ProfileCreatedEventSchema", () => {
    const timestamp = new Date().toISOString();
    const event = {
      eventId: "evt_01HXYZ123456789",
      eventType: PROFILE_CREATED_SUBJECT,
      timestamp,
      change: { type: "created" as const },
      profile: {
        id: "user_123",
        displayName: "Ada Lovelace",
        handle: "ada-lovelace",
        claimGeneration: 1,
        biographyMarkdown: "",
        pictureAssetId: null,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    };

    it("validates a profile creation event", () => {
      expect(ProfileCreatedEventSchema.safeParse(event).success).toBe(true);
    });

    it("preserves alias lifetime metadata while accepting retained snapshots", () => {
      const alias = { handle: "ada", claimGeneration: 1 };
      const snapshotWithAliases = (aliases: unknown[]) => ({
        ...event,
        profile: { ...event.profile, aliases },
      });
      const withLifetime = snapshotWithAliases([
        { ...alias, createdAt: timestamp, expiresAt: null },
        {
          handle: "ada-byron",
          claimGeneration: 2,
          createdAt: timestamp,
          expiresAt: "2026-10-01T00:00:00.000Z",
        },
      ]);

      expect(ProfileCreatedEventSchema.parse(withLifetime)).toEqual(withLifetime);
      expect(ProfileCreatedEventSchema.safeParse(snapshotWithAliases([alias])).success).toBe(
        true
      );
      expect(ProfileCreatedEventSchema.safeParse(event).success).toBe(true);
      expect(
        ProfileCreatedEventSchema.safeParse(
          snapshotWithAliases([{ ...alias, createdAt: timestamp, expiresAt: "tomorrow" }])
        ).success
      ).toBe(false);
    });

    it("rejects an invalid profile version", () => {
      expect(
        ProfileCreatedEventSchema.safeParse({
          ...event,
          profile: { ...event.profile, version: 0 },
        }).success
      ).toBe(false);
    });

    it("requires a typed change", () => {
      const { change: _change, ...withoutChange } = event;
      expect(ProfileCreatedEventSchema.safeParse(withoutChange).success).toBe(false);
    });

    it("rejects fields outside the public Profile contract", () => {
      expect(
        ProfileCreatedEventSchema.safeParse({
          ...event,
          profile: { ...event.profile, clerkEmail: "ada@example.com" },
        }).success
      ).toBe(false);
    });
  });

  describe("ProfileUpdatedEventSchema", () => {
    const timestamp = new Date().toISOString();
    const event = {
      eventId: "evt_01HXYZ987654321",
      eventType: PROFILE_UPDATED_SUBJECT,
      timestamp,
      change: {
        type: "display-name-changed" as const,
        before: "Ada Lovelace",
        after: "Ada Byron",
      },
      profile: {
        id: "user_123",
        displayName: "Ada Byron",
        handle: "ada-lovelace",
        claimGeneration: 1,
        biographyMarkdown: "",
        pictureAssetId: null,
        version: 2,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    };

    it("validates a Display-name change with its before and after values", () => {
      expect(ProfileUpdatedEventSchema.safeParse(event).success).toBe(true);
    });

    it("records uploaded, imported, and removed Profile pictures with delivery metadata", () => {
      const asset = {
        id: "pic_new", storageBucket: "profile-pictures", storageKey: "user_123/pic_new.webp",
        mimeType: "image/webp", width: 128, height: 128, fileSizeBytes: 512,
      };
      for (const source of ["upload", "clerk-import", "remove"]) {
        const picture = source === "remove" ? null : asset;
        const changed = {
          ...event,
          change: { type: "picture-changed", before: "pic_old", after: picture?.id ?? null, source, asset: picture },
          profile: { ...event.profile, pictureAssetId: picture?.id ?? null },
        };
        expect(ProfileUpdatedEventSchema.parse(changed)).toEqual(changed);
      }
      const changed = {
        ...event,
        change: { type: "picture-changed", before: null, after: asset.id, source: "upload", asset },
        profile: { ...event.profile, pictureAssetId: asset.id },
      };
      for (const invalidAsset of [{ ...asset, mimeType: "image/svg+xml" }, { ...asset, width: 0 }, { ...asset, fileSizeBytes: -1 }]) {
        expect(ProfileUpdatedEventSchema.safeParse({ ...changed, change: { ...changed.change, asset: invalidAsset } }).success).toBe(false);
      }
      expect(ProfileUpdatedEventSchema.safeParse({ ...changed, profile: { ...changed.profile, storageKey: asset.storageKey } }).success).toBe(false);
    });

    it("records released alias reactivation and scheduled expiry cancellation", () => {
      for (const before of [null, timestamp]) {
        const reactivated = {
          ...event,
          change: { type: "alias-reactivated", handle: "old-handle", claimGeneration: 3, before, after: null },
          profile: { ...event.profile, aliases: [{ handle: "old-handle", claimGeneration: 3, createdAt: timestamp, expiresAt: null }] },
        };
        expect(ProfileUpdatedEventSchema.parse(reactivated)).toEqual(reactivated);
        expect(ProfileUpdatedEventSchema.safeParse({ ...reactivated, change: { ...reactivated.change, claimGeneration: 0 } }).success).toBe(false);
        expect(ProfileUpdatedEventSchema.safeParse({ ...reactivated, change: { ...reactivated.change, before: "yesterday" } }).success).toBe(false);
      }
    });

    it("records automatic and immediate alias expiry with the released claim generation", () => {
      for (const reason of ["scheduled", "immediate"]) {
        const expired = {
          ...event,
          change: {
            type: "alias-expired", handle: "old-handle", claimGeneration: 2,
            before: timestamp, after: null, reason,
          },
          profile: { ...event.profile, aliases: [] },
        };
        expect(ProfileUpdatedEventSchema.parse(expired)).toEqual(expired);
        expect(ProfileUpdatedEventSchema.safeParse({ ...expired, change: { ...expired.change, claimGeneration: 0 } }).success).toBe(false);
      }
    });

    it("validates an alias expiry schedule with its authoritative snapshot", () => {
      const expiresAt = "2026-10-01T00:00:00.000Z";
      const scheduled = {
        ...event,
        change: {
          type: "alias-expiry-scheduled",
          handle: "ada",
          before: null,
          after: expiresAt,
        },
        profile: {
          ...event.profile,
          aliases: [
            { handle: "ada", claimGeneration: 1, createdAt: timestamp, expiresAt },
          ],
        },
      };

      expect(ProfileUpdatedEventSchema.parse(scheduled)).toEqual(scheduled);
      expect(
        ProfileUpdatedEventSchema.safeParse({
          ...scheduled,
          change: { ...scheduled.change, after: "tomorrow" },
        }).success
      ).toBe(false);
      expect(
        ProfileUpdatedEventSchema.safeParse({
          ...scheduled,
          change: { ...scheduled.change, before: timestamp },
        }).success
      ).toBe(false);
    });

    it("preserves Handle-change scheduling metadata and accepts retained changes", () => {
      const expiresAt = "2026-10-01T00:00:00.000Z";
      const retained = {
        ...event,
        change: { type: "handle-changed", before: "ada", after: "ada-lovelace" },
        profile: {
          ...event.profile,
          aliases: [{ handle: "ada", claimGeneration: 1 }],
        },
      };
      const scheduled = {
        ...retained,
        change: {
          ...retained.change,
          scheduledAliases: [{ handle: "ada", expiresAt }],
        },
        profile: {
          ...retained.profile,
          aliases: [
            { handle: "ada", claimGeneration: 1, createdAt: timestamp, expiresAt },
          ],
        },
      };

      expect(ProfileUpdatedEventSchema.parse(scheduled)).toEqual(scheduled);
      expect(ProfileUpdatedEventSchema.parse(retained)).toEqual(retained);
      expect(
        ProfileUpdatedEventSchema.safeParse({
          ...scheduled,
          change: {
            ...scheduled.change,
            scheduledAliases: [{ handle: "ada", expiresAt: "tomorrow" }],
          },
        }).success
      ).toBe(false);
    });

    it("rejects private or incomplete changes", () => {
      expect(
        ProfileUpdatedEventSchema.safeParse({
          ...event,
          profile: { ...event.profile, clerkEmail: "ada@example.com" },
        }).success
      ).toBe(false);
      expect(
        ProfileUpdatedEventSchema.safeParse({
          ...event,
          change: { type: "display-name-changed", after: "Ada Byron" },
        }).success
      ).toBe(false);
    });
  });

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
      expect(WALLPAPER_VARIANT_AVAILABLE_SUBJECT).toBe("wallpaper.variant.available");
    });
  });

  describe("WallpaperColorsExtractedEventSchema", () => {
    const validEvent = {
      eventId: "evt_01HXYZ123456789",
      eventType: "wallpaper.colors.extracted" as const,
      timestamp: new Date().toISOString(),
      wallpaperId: "wlpr_01HXYZ123456789",
      colorHistogram: new Array(64).fill(0).map((_, i) => (i === 0 ? 1.0 : 0)) as number[],
      colorSpace: "hsv",
    };

    it("should validate a correct event", () => {
      const result = WallpaperColorsExtractedEventSchema.safeParse(validEvent);
      expect(result.success).toBe(true);
    });

    it("should reject event with wrong eventType", () => {
      const invalid = { ...validEvent, eventType: "wrong.type" };
      const result = WallpaperColorsExtractedEventSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject event with missing wallpaperId", () => {
      const { wallpaperId: _id, ...invalid } = validEvent;
      const result = WallpaperColorsExtractedEventSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject event with empty colorHistogram", () => {
      const invalid = { ...validEvent, colorHistogram: [] };
      const result = WallpaperColorsExtractedEventSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject event with empty colorSpace", () => {
      const invalid = { ...validEvent, colorSpace: "" };
      const result = WallpaperColorsExtractedEventSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });

    it("should reject event with invalid timestamp", () => {
      const invalid = { ...validEvent, timestamp: "not-a-date" };
      const result = WallpaperColorsExtractedEventSchema.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe("WALLPAPER_COLORS_EXTRACTED_SUBJECT", () => {
    it("should have the correct subject name", () => {
      expect(WALLPAPER_COLORS_EXTRACTED_SUBJECT).toBe("wallpaper.colors.extracted");
    });
  });
});
