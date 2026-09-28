import { Effect, Layer, Metric } from 'effect';
import type { DeliveryLimits, ResizeOptions } from './contract.js';
import {
  AssetReader,
  Catalog,
  DeliveryUnavailable,
  ImageTransformer,
  MediaDelivery,
  PictureAuthority,
} from './contract.js';

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
          let rendition = variant ?? wallpaper;
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
            rendition = wallpaper;
          }
          if (!body) return { _tag: 'NotFound' } as const;
          const matchesRendition =
            options?.width === rendition.width && options?.height === rendition.height;
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
