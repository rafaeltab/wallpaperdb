import { z } from "zod";

/** Immutable producer-owned identity. Only object-storage adapters resolve its address. */
export const AssetReferenceSchema = z
  .object({
    owner: z.enum(["ingestor", "variant-generator", "user"]),
    id: z.string().min(1).max(1024),
  })
  .strict();
export type AssetReference = z.infer<typeof AssetReferenceSchema>;
