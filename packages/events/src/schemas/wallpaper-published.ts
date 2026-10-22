import { z } from "zod";
const identity = z.string().min(1).max(256);
/** Wallpaper-owned existence/publication fact. Asset owns Source bytes and public
 * delivery availability. Consumers join those facts independently. */
export const WallpaperPublishedSchema = z
  .object({
    wallpaperId: identity,
    contributorId: identity,
    assetId: identity,
    firstSourceId: identity,
    initialAnalysisSourceId: identity,
  })
  .strict();
export type WallpaperPublished = z.infer<typeof WallpaperPublishedSchema>;
