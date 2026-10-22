import { z } from "zod";

const utf8 = (maximum: number) =>
  z
    .string()
    .min(1)
    .refine(
      (value) => new TextEncoder().encode(value).length <= maximum,
      `Exceeds ${maximum} UTF-8 bytes`
    );
export const AssetIdentifierSchema = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
export const OwnerValueSchema = utf8(256);
const correlation = {
  commandId: utf8(128),
  applicationReference: z.string().refine((value) => new TextEncoder().encode(value).length <= 256),
};
export const CreateAssetSchema = z
  .object({ ...correlation, assetType: AssetIdentifierSchema, ownerSubject: OwnerValueSchema })
  .strict();
export const DeleteAssetSchema = z.object({ ...correlation, assetId: utf8(256) }).strict();
export const AssetRejectionReasonSchema = z.enum([
  "malformed-command",
  "idempotency-conflict",
  "forbidden-operation",
  "unsupported-type",
  "unavailable-asset",
]);
export const AssetCommandResultSchema = z.discriminatedUnion("outcome", [
  z.object({ ...correlation, assetId: utf8(256), outcome: z.literal("created") }).strict(),
  z.object({ ...correlation, assetId: utf8(256), outcome: z.literal("deleted") }).strict(),
  z.object({ ...correlation, assetId: utf8(256), outcome: z.literal("already-deleted") }).strict(),
  z
    .object({
      ...correlation,
      assetId: utf8(256).nullable(),
      outcome: z.literal("rejected"),
      reason: AssetRejectionReasonSchema,
    })
    .strict(),
]);
export type CreateAsset = z.infer<typeof CreateAssetSchema>;
export type DeleteAsset = z.infer<typeof DeleteAssetSchema>;
export type AssetCommandResult = z.infer<typeof AssetCommandResultSchema>;
