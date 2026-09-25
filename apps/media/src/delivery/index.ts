import { Context, Effect, Layer, Schema } from 'effect';

export interface StoredAsset {
  readonly storageBucket: string;
  readonly storageKey: string;
}
export interface Wallpaper extends StoredAsset {
  readonly id: string;
  readonly mimeType: string;
  readonly fileSizeBytes: number;
  readonly width: number;
  readonly height: number;
}
export interface Variant {
  readonly id: string;
  readonly storageKey: string;
  readonly width: number;
  readonly height: number;
}
export interface ResizeOptions {
  readonly width?: number;
  readonly height?: number;
  readonly fit: 'contain' | 'cover' | 'fill';
}
export class DeliveryUnavailable extends Schema.TaggedError<DeliveryUnavailable>()(
  'DeliveryUnavailable',
  { operation: Schema.String, cause: Schema.Defect() }
) {}
export interface Catalog {
  findWallpaper(id: string): Effect.Effect<Wallpaper | null, DeliveryUnavailable>;
  findSmallestVariant(
    id: string,
    minWidth: number,
    minHeight: number
  ): Effect.Effect<Variant | null, DeliveryUnavailable>;
  findCurrentPicture(id: string): Effect.Effect<StoredAsset | null, DeliveryUnavailable>;
}
export const Catalog = Context.Service<Catalog>('wallpaperdb.media.delivery.Catalog');
/** Missing objects return null. Failed reads fail; iterators propagate stream errors and release resources on return. */
export interface AssetReader {
  read(asset: StoredAsset): Effect.Effect<AsyncIterable<Uint8Array> | null, DeliveryUnavailable>;
}
export const AssetReader = Context.Service<AssetReader>('wallpaperdb.media.delivery.AssetReader');
export interface PictureAuthority {
  isAvailable(id: string): Effect.Effect<boolean, DeliveryUnavailable>;
}
export const PictureAuthority = Context.Service<PictureAuthority>(
  'wallpaperdb.media.delivery.PictureAuthority'
);
export interface ImageTransformer {
  resize(
    body: AsyncIterable<Uint8Array>,
    options: ResizeOptions & { readonly mimeType: string }
  ): Effect.Effect<AsyncIterable<Uint8Array>, DeliveryUnavailable>;
}
export const ImageTransformer = Context.Service<ImageTransformer>(
  'wallpaperdb.media.delivery.ImageTransformer'
);
export type MediaOutcome =
  | {
      readonly _tag: 'Found';
      readonly body: AsyncIterable<Uint8Array>;
      readonly mimeType: string;
      readonly fileSizeBytes?: number;
    }
  | { readonly _tag: 'NotFound' }
  | { readonly _tag: 'Rejected'; readonly reason: string };
export interface MediaDelivery {
  wallpaper(id: string, options?: ResizeOptions): Effect.Effect<MediaOutcome, DeliveryUnavailable>;
  picture(id: string): Effect.Effect<MediaOutcome, DeliveryUnavailable>;
}
export const MediaDelivery = Context.Service<MediaDelivery>(
  'wallpaperdb.media.delivery.MediaDelivery'
);
export interface DeliveryLimits {
  readonly maxDimension: number;
  readonly maxOutputPixels: number;
  readonly maxPictureBytes?: number;
}
export const deliveryLayer = (_limits: DeliveryLimits) =>
  Layer.effect(
    MediaDelivery,
    Effect.gen(function* () {
      const catalog = yield* Catalog;
      const assets = yield* AssetReader;
      const transformer = yield* ImageTransformer;
      return MediaDelivery.of({
        wallpaper: Effect.fn('media.get_wallpaper_resized')(function* (
          id: string,
          options?: ResizeOptions
        ) {
          const wallpaper = yield* catalog.findWallpaper(id);
          if (!wallpaper) return { _tag: 'NotFound' } as const;
          const variant =
            options && (options.width || options.height)
              ? yield* catalog.findSmallestVariant(
                  id,
                  options.width ?? wallpaper.width,
                  options.height ?? wallpaper.height
                )
              : null;
          const source = variant ? { ...wallpaper, storageKey: variant.storageKey } : wallpaper;
          const body = yield* assets.read(source);
          if (!body) return { _tag: 'NotFound' } as const;
          if (options && (options.width || options.height)) {
            const resized = yield* transformer.resize(body, {
              ...options,
              mimeType: wallpaper.mimeType,
            });
            return { _tag: 'Found', body: resized, mimeType: wallpaper.mimeType } as const;
          }
          return {
            _tag: 'Found',
            body,
            mimeType: wallpaper.mimeType,
            fileSizeBytes: wallpaper.fileSizeBytes,
          } as const;
        }),
        picture: () => Effect.succeed({ _tag: 'NotFound' }),
      });
    })
  );
