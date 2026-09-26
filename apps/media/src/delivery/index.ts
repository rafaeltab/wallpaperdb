import { Context, Effect, Layer, Metric, Schema } from 'effect';

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
export interface Variant extends StoredAsset {
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
export interface AssetBody extends AsyncIterable<Uint8Array> {
  close(): void;
}
/** Missing objects return null. Failed reads fail; iterators propagate stream errors and release resources on return. */
export interface AssetReader {
  read(
    asset: StoredAsset,
    context?: { readonly source: 'original' | 'variant'; readonly fallback?: boolean }
  ): Effect.Effect<AssetBody | null, DeliveryUnavailable>;
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
    body: AssetBody,
    options: ResizeOptions & { readonly mimeType: string }
  ): Effect.Effect<AssetBody, DeliveryUnavailable>;
}
export const ImageTransformer = Context.Service<ImageTransformer>(
  'wallpaperdb.media.delivery.ImageTransformer'
);
export type MediaOutcome =
  | {
      readonly _tag: 'Found';
      readonly body: AssetBody;
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
  readonly maxResizeWidth: number;
  readonly maxResizeHeight: number;
  readonly maxOutputPixels: number;
  readonly maxPictureBytes?: number;
}
export const deliveryLayer = (limits: DeliveryLimits) =>
  Layer.effect(
    MediaDelivery,
    Effect.gen(function* () {
      const catalog = yield* Catalog;
      const assets = yield* AssetReader;
      const transformer = yield* ImageTransformer;
      const authority = yield* PictureAuthority;
      return MediaDelivery.of({
        wallpaper: Effect.fn('media.get_wallpaper_resized')(function* (
          id: string,
          options?: ResizeOptions
        ) {
          if (
            options &&
            [options.width, options.height].some(
              (n, index) =>
                n !== undefined &&
                (!Number.isSafeInteger(n) ||
                  n < 1 ||
                  n > (index === 0 ? limits.maxResizeWidth : limits.maxResizeHeight))
            )
          ) {
            return {
              _tag: 'Rejected',
              reason: 'Requested dimensions exceed media limits',
            } as const;
          }
          const wallpaper = yield* catalog.findWallpaper(id);
          if (!wallpaper) return { _tag: 'NotFound' } as const;
          if (options && (options.width || options.height)) {
            const width =
              options.width ??
              Math.ceil(
                (wallpaper.width * (options.height ?? wallpaper.height)) / wallpaper.height
              );
            const height =
              options.height ??
              Math.ceil((wallpaper.height * (options.width ?? wallpaper.width)) / wallpaper.width);
            if (
              width > limits.maxResizeWidth ||
              height > limits.maxResizeHeight ||
              width * height > limits.maxOutputPixels
            ) {
              return { _tag: 'Rejected', reason: 'Requested output exceeds media limits' } as const;
            }
          }
          const wouldUpscale =
            options?.fit !== 'fill' &&
            ((options?.width ?? wallpaper.width) > wallpaper.width ||
              (options?.height ?? wallpaper.height) > wallpaper.height);
          const variant =
            options && (options.width || options.height) && !wouldUpscale
              ? yield* catalog.findSmallestVariant(
                  id,
                  options.width ?? wallpaper.width,
                  options.height ?? wallpaper.height
                )
              : null;
          yield* Metric.update(
            Metric.counter('media.variant_selection.total', {
              incremental: true,
              attributes: {
                result:
                  !options || (!options.width && !options.height)
                    ? 'no_resize'
                    : wouldUpscale
                      ? 'upscale_avoided'
                      : variant
                        ? 'hit'
                        : 'miss',
              },
            }),
            1
          );
          if (variant)
            yield* Metric.update(
              Metric.histogram('media.variant_selection.efficiency_percent', {
                boundaries: [0, 25, 50, 75, 90, 100],
                attributes: { 'wallpaper.id': id },
              }),
              Number(
                (
                  (1 - (variant.width * variant.height) / (wallpaper.width * wallpaper.height)) *
                  100
                ).toFixed(2)
              )
            );
          const source = variant
            ? { ...wallpaper, storageKey: variant.storageKey, storageBucket: variant.storageBucket }
            : wallpaper;
          let body = yield* assets.read(source, { source: variant ? 'variant' : 'original' });
          if (!body && variant) {
            yield* Metric.update(
              Metric.counter('media.variant.fallback.total', {
                incremental: true,
                attributes: { 'wallpaper.id': id, 'variant.id': variant.id },
              }),
              1
            );
            body = yield* assets.read(wallpaper, { source: 'original', fallback: true });
          }
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
        picture: Effect.fn('media.get_picture')(function* (id: string) {
          const asset = yield* catalog.findCurrentPicture(id);
          if (!asset || !(yield* authority.isAvailable(id))) return { _tag: 'NotFound' } as const;
          const stream = yield* assets.read(asset);
          if (!stream)
            return yield* Effect.fail(
              new DeliveryUnavailable({
                operation: 'read_picture',
                cause: new Error('Authorized picture object is missing'),
              })
            );
          const bytes = yield* Effect.tryPromise({
            try: async (signal) => {
              signal.addEventListener('abort', () => stream.close(), { once: true });
              const chunks: Uint8Array[] = [];
              let length = 0;
              for await (const chunk of stream) {
                length += chunk.byteLength;
                if (length > (limits.maxPictureBytes ?? 10 * 1024 * 1024))
                  throw new Error('Picture exceeds byte limit');
                chunks.push(chunk);
              }
              const result = new Uint8Array(length);
              let offset = 0;
              for (const chunk of chunks) {
                result.set(chunk, offset);
                offset += chunk.byteLength;
              }
              return result;
            },
            catch: (cause) => new DeliveryUnavailable({ operation: 'read_picture', cause }),
          });
          return {
            _tag: 'Found',
            body: Object.assign(
              (async function* () {
                yield bytes;
              })(),
              { close() {} }
            ),
            mimeType: 'image/webp',
            fileSizeBytes: bytes.byteLength,
          } as const;
        }),
      });
    })
  );
