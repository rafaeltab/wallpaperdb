import { Effect, Layer, Metric } from 'effect';
import type { DeliveryLimits, ResizeOptions, ImageGeometry } from './contract.js';
import {
  AssetReader,
  Catalog,
  DeliveryUnavailable,
  ImageTransformer,
  MediaDelivery,
  PictureAuthority,
} from './contract.js';

function exceedsOutputLimits(
  geometry: ImageGeometry,
  options: ResizeOptions,
  limits: DeliveryLimits
): boolean {
  const width =
    options.width ??
    Math.ceil((geometry.width * (options.height ?? geometry.height)) / geometry.height);
  const height =
    options.height ??
    Math.ceil((geometry.height * (options.width ?? geometry.width)) / geometry.width);
  return (
    width > limits.maxResizeWidth ||
    height > limits.maxResizeHeight ||
    width * height > limits.maxOutputPixels
  );
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
          const hasBothDimensions = options?.width !== undefined && options?.height !== undefined;
          if (
            options &&
            [options.width, options.height].some(
              (n, index) =>
                n !== undefined &&
                (!Number.isSafeInteger(n) ||
                  n < 1 ||
                  (!hasBothDimensions &&
                    n > (index === 0 ? limits.maxResizeWidth : limits.maxResizeHeight)))
            )
          ) {
            return {
              _tag: 'Rejected',
              reason: 'Requested dimensions exceed media limits',
            } as const;
          }
          const wallpaper = yield* catalog.findWallpaper(id);
          if (!wallpaper) return { _tag: 'NotFound' } as const;
          const resizing =
            options !== undefined && (options.width !== undefined || options.height !== undefined);
          let geometry: ImageGeometry | undefined;
          if (resizing) {
            // Catalog facts retain their historical raw/nominal meaning. Inspect immutable
            // bytes for this request instead of rewriting existing rows or trusting new ingestion.
            const inspection = yield* assets.read(wallpaper, { source: 'original' });
            if (inspection) geometry = yield* transformer.inspect(inspection);
          }
          const matchesOriginal =
            geometry !== undefined &&
            options?.width === geometry.width &&
            options?.height === geometry.height;
          if (
            !matchesOriginal &&
            ((options?.width ?? 0) > limits.maxResizeWidth ||
              (options?.height ?? 0) > limits.maxResizeHeight)
          ) {
            return {
              _tag: 'Rejected',
              reason: 'Requested dimensions exceed media limits',
            } as const;
          }
          if (!matchesOriginal && options && (options.width || options.height)) {
            if (
              geometry
                ? exceedsOutputLimits(geometry, options, limits)
                : options.width !== undefined &&
                  options.height !== undefined &&
                  options.width * options.height > limits.maxOutputPixels
            ) {
              return { _tag: 'Rejected', reason: 'Requested output exceeds media limits' } as const;
            }
          }
          const wouldUpscale =
            geometry !== undefined &&
            options?.fit !== 'fill' &&
            ((options?.width ?? geometry.width) > geometry.width ||
              (options?.height ?? geometry.height) > geometry.height);
          const variant =
            !matchesOriginal &&
            options &&
            (options.width || options.height) &&
            !wouldUpscale &&
            !geometry?.requiresOrientation
              ? yield* catalog.findSmallestVariant(
                  id,
                  options.width ?? geometry?.width ?? 1,
                  options.height ?? geometry?.height ?? 1
                )
              : null;
          yield* Metric.update(
            Metric.counter('media.variant_selection.total', {
              incremental: true,
              attributes: {
                result:
                  matchesOriginal || !options || (!options.width && !options.height)
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
          if (variant && geometry)
            yield* Metric.update(
              Metric.histogram('media.variant_selection.efficiency_percent', {
                boundaries: [0, 25, 50, 75, 90, 100],
                attributes: { 'wallpaper.id': id },
              }),
              Number(
                (
                  (1 - (variant.width * variant.height) / (geometry.width * geometry.height)) *
                  100
                ).toFixed(2)
              )
            );
          const source = variant
            ? { ...wallpaper, storageKey: variant.storageKey, storageBucket: variant.storageBucket }
            : wallpaper;
          let rendition = variant ?? wallpaper;
          let renditionGeometry = geometry;
          if (resizing && !geometry && !variant) return { _tag: 'NotFound' } as const;
          let body = yield* assets.read(source, { source: variant ? 'variant' : 'original' });
          if (body && variant && options) {
            renditionGeometry = yield* transformer.inspect(body);
            // Historical variants can advertise nominal bounds. Never admit an
            // inferred output using those bounds when their actual pixels disagree.
            if (
              (geometry !== undefined && renditionGeometry.requiresOrientation) ||
              exceedsOutputLimits(renditionGeometry, options, limits)
            ) {
              if (!geometry)
                return {
                  _tag: 'Rejected',
                  reason: 'Requested output exceeds media limits',
                } as const;
              body = null;
            } else {
              body = yield* assets.read(source, { source: 'variant' });
            }
          }
          if (!body && variant) {
            if (!geometry) return { _tag: 'NotFound' } as const;
            yield* Metric.update(
              Metric.counter('media.variant.fallback.total', {
                incremental: true,
                attributes: { 'wallpaper.id': id, 'variant.id': variant.id },
              }),
              1
            );
            body = yield* assets.read(wallpaper, { source: 'original', fallback: true });
            rendition = wallpaper;
            renditionGeometry = geometry;
          }
          if (!body) return { _tag: 'NotFound' } as const;
          const matchesRendition =
            !(rendition === variant && renditionGeometry?.requiresOrientation) &&
            options?.width === renditionGeometry?.width &&
            options?.height === renditionGeometry?.height;
          if (options && (options.width || options.height) && !matchesRendition) {
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
            fileSizeBytes: rendition === wallpaper ? wallpaper.fileSizeBytes : undefined,
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
