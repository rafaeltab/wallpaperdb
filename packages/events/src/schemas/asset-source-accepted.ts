import { z } from "zod";
import { AssetIdentifierSchema } from "./asset-commands.js";
const identity = z.string().min(1).max(256);
const revision = z.string().regex(/^(0|[1-9][0-9]{0,39})$/);
/** Committed logical membership confirmation. Consumers join their own Asset/intent
 * record; the event contains neither Owner claims nor object-storage coordinates. */
export const AssetSourceAcceptedSchema = z
  .object({
    assetId: identity,
    assetType: AssetIdentifierSchema,
    candidateId: identity,
    sourceId: identity,
    defaultSourceId: identity,
    sourceSetRevision: revision,
    deliveryRevision: revision,
    initialAnalysisSourceId: identity,
  })
  .strict();
export type AssetSourceAccepted = z.infer<typeof AssetSourceAcceptedSchema>;
