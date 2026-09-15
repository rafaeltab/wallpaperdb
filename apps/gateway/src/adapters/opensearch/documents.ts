import { z } from 'zod';

const variant = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  aspectRatio: z.number().positive(),
  format: z.string().min(1),
  fileSizeBytes: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});

export const wallpaperDocument = z
  .object({
    wallpaperId: z.string().min(1),
    userId: z.string().min(1),
    variants: z.array(variant),
    uploadedAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .transform(({ userId, ...wallpaper }) => ({ ...wallpaper, profileId: userId }));

export const profileDocument = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  handle: z.string().min(1),
  claimGeneration: z.number().int().positive(),
  biographyMarkdown: z.string(),
  pictureAssetId: z.string().min(1).nullable(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const wallpaperResponse = z.object({ _source: wallpaperDocument });
export const profileResponse = z.object({ _source: profileDocument });
export const partialWallpaperResponse = z.object({
  _source: z.object({ userId: z.unknown().optional() }),
});
export const profileBatchResponse = z.object({
  docs: z.array(
    z.union([
      z.object({ found: z.literal(false) }).transform(() => null),
      z
        .object({ found: z.literal(true), _source: profileDocument })
        .transform((document) => document._source),
    ])
  ),
});
export const profileSearchResponse = z.object({
  hits: z.object({ hits: z.array(z.object({ _source: profileDocument })) }),
});
export const wallpaperSearchResponse = z.object({
  hits: z.object({
    hits: z.array(
      z.object({
        _source: wallpaperDocument,
        sort: z.array(z.union([z.string(), z.number().finite()])),
      })
    ),
    total: z.object({ value: z.number().int().nonnegative() }),
  }),
});
export const updateResponse = z.object({ result: z.enum(['created', 'updated', 'noop']) });
export const storageError = z.object({
  meta: z.object({
    statusCode: z.number(),
    body: z.object({ error: z.object({ type: z.string() }).optional() }).optional(),
  }),
});
