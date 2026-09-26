import { describe, expect, it } from "vitest";
import {
  resolveOriginalAsset,
  resolveProfilePictureAsset,
  resolveVariantAsset,
} from "../src/assets/index.js";

describe("deterministic immutable asset addresses", () => {
  it.each([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"],
  ])("preserves the stored original path for %s", (mimeType, extension) => {
    expect(
      resolveOriginalAsset({ owner: "ingestor", id: "wlpr_01ABC" }, mimeType, "wallpapers")
    ).toEqual({ bucket: "wallpapers", key: `wlpr_01ABC/original.${extension}` });
  });

  it("resolves a rendition from its stable target identity rather than its encoded dimensions", () => {
    expect(
      resolveVariantAsset(
        { owner: "variant-generator", id: "wlpr_01ABC:854x480:image/png" },
        { wallpaperId: "wlpr_01ABC", mimeType: "image/png" },
        "wallpapers"
      )
    ).toEqual({ bucket: "wallpapers", key: "wlpr_01ABC/variant_854x480.png" });
  });

  it("preserves the private Profile picture path using the owning Profile", () => {
    expect(
      resolveProfilePictureAsset({ owner: "user", id: "pic_01ABC" }, "user_01ABC", "pictures")
    ).toEqual({ bucket: "pictures", key: "user_01ABC/pic_01ABC.webp" });
  });

  it("rejects references owned by another producer", () => {
    expect(() =>
      resolveOriginalAsset({ owner: "user", id: "pic_1" }, "image/png", "assets")
    ).toThrow();
    expect(() =>
      resolveVariantAsset(
        { owner: "ingestor", id: "wlpr_1:854x480:image/png" },
        { wallpaperId: "wlpr_1", mimeType: "image/png" },
        "assets"
      )
    ).toThrow();
    expect(() =>
      resolveProfilePictureAsset({ owner: "ingestor", id: "wlpr_1" }, "user_1", "pictures")
    ).toThrow();
  });

  it.each([
    "",
    "../other",
    "a/b",
    "a\\b",
    "%2e%2e",
    "with space",
  ])("rejects unsafe path component %j", (id) => {
    expect(() => resolveOriginalAsset({ owner: "ingestor", id }, "image/png", "assets")).toThrow();
    expect(() => resolveProfilePictureAsset({ owner: "user", id }, "user_1", "pictures")).toThrow();
    expect(() =>
      resolveProfilePictureAsset({ owner: "user", id: "pic_1" }, id, "pictures")
    ).toThrow();
  });

  it.each([
    "other:854x480:image/png",
    "wlpr_1:854x480:image/jpeg",
    "wlpr_1:0x480:image/png",
    "wlpr_1:-1x480:image/png",
    "wlpr_1:854x0:image/png",
    "wlpr_1:8.5x480:image/png",
    "wlpr_1:0854x480:image/png",
    "wlpr_1:9007199254740992x480:image/png",
    "wlpr_1:854x480:image/png:extra",
  ])("rejects ambiguous or inconsistent rendition identity %s", (id) => {
    expect(() =>
      resolveVariantAsset(
        { owner: "variant-generator", id },
        { wallpaperId: "wlpr_1", mimeType: "image/png" },
        "assets"
      )
    ).toThrow();
  });

  it("rejects unsupported formats instead of guessing an extension", () => {
    expect(() =>
      resolveOriginalAsset({ owner: "ingestor", id: "wlpr_1" }, "image/gif", "assets")
    ).toThrow();
    expect(() =>
      resolveVariantAsset(
        { owner: "variant-generator", id: "wlpr_1:854x480:image/gif" },
        { wallpaperId: "wlpr_1", mimeType: "image/gif" },
        "assets"
      )
    ).toThrow();
  });
});
