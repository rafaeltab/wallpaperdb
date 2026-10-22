import { describe, expect, it } from "vitest";
import { CreateAssetSchema, AssetCommandResultSchema } from "../src/schemas/index.js";

describe("generic Asset commands", () => {
  const create = {
    commandId: "create-1",
    applicationReference: "profile-1",
    assetType: "picture",
    ownerSubject: "user_1",
  };
  it("bounds opaque UTF-8 fields and excludes authority supplied by the body", () => {
    expect(CreateAssetSchema.parse(create)).toEqual(create);
    expect(CreateAssetSchema.safeParse({ ...create, ownerNamespace: "other" }).success).toBe(false);
    expect(
      CreateAssetSchema.safeParse({ ...create, applicationReference: "é".repeat(129) }).success
    ).toBe(false);
    expect(CreateAssetSchema.safeParse({ ...create, commandId: "x".repeat(129) }).success).toBe(
      false
    );
    expect(CreateAssetSchema.safeParse({ ...create, assetType: "picture.*" }).success).toBe(false);
  });
  it("requires a successful identity and a safe rejected reason", () => {
    const result = {
      commandId: "create-1",
      applicationReference: "profile-1",
      assetId: "asset_1",
      outcome: "created",
    };
    expect(AssetCommandResultSchema.safeParse(result).success).toBe(true);
    expect(AssetCommandResultSchema.safeParse({ ...result, assetId: null }).success).toBe(false);
    expect(
      AssetCommandResultSchema.safeParse({
        ...result,
        outcome: "rejected",
        assetId: null,
        reason: "idempotency-conflict",
      }).success
    ).toBe(true);
    expect(
      AssetCommandResultSchema.safeParse({
        ...result,
        outcome: "rejected",
        reason: "secret database exception",
      }).success
    ).toBe(false);
  });
});
