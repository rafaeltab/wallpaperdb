import {
  createDefaultTesterBuilder,
  DockerTesterBuilder,
  S3TesterBuilder,
} from "@wallpaperdb/test-utils";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerAssetReference, resolveAssetReference } from "../../src/assets/index.js";

const Tester = createDefaultTesterBuilder().with(DockerTesterBuilder).with(S3TesterBuilder).build();
const tester = new Tester().withS3().withS3Bucket("asset-references");

describe("immutable asset references", () => {
  beforeAll(() => tester.setup());
  afterAll(() => tester.destroy());

  it("resolves the recorded location after an identical registration retry", async () => {
    const client = tester.s3.getS3Client();
    const reference = { owner: "user", id: "picture-1" } as const;
    const location = { bucket: "retained-private-bucket", key: "original/path.webp" };
    await registerAssetReference(client, "asset-references", reference, location);
    await registerAssetReference(client, "asset-references", reference, location);
    expect(await resolveAssetReference(client, "asset-references", reference)).toEqual(location);
  });

  it("refuses to reassign a logical identity to another stored object", async () => {
    const client = tester.s3.getS3Client();
    const reference = { owner: "ingestor", id: "wallpaper-1" } as const;
    const original = { bucket: "old-bucket", key: "wallpaper/original.png" };
    await registerAssetReference(client, "asset-references", reference, original);
    await expect(
      registerAssetReference(client, "asset-references", reference, {
        bucket: "new-bucket",
        key: "replacement.png",
      })
    ).rejects.toThrow("Asset reference is already assigned");
    expect(await resolveAssetReference(client, "asset-references", reference)).toEqual(original);
  });
});
