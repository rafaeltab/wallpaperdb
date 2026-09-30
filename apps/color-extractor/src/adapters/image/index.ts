import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { GetObjectCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Context, Effect, Layer, Semaphore } from 'effect';
import { resolveOriginalAsset } from '@wallpaperdb/core/assets';
import { decodePixels } from './process.js';
import { measurePixels } from './measurements.js';
import {
  ExtractionUnavailable,
  ImageMeasurements,
  type OriginalImage,
} from '../../capabilities/extraction/index.js';

export interface ImageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
}

export interface ImageHealth {
  check(): Effect.Effect<boolean>;
}
export const ImageHealth = Context.Service<ImageHealth>('wallpaperdb.color-extractor.image.health');

// Match the largest image accepted by Ingestor; enforce this independently of S3 metadata.
const maxImageBytes = 50 * 1024 * 1024;

const request = <A>(operation: string, send: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: send,
    catch: (cause) => new ExtractionUnavailable({ operation, cause }),
  }).pipe(
    Effect.tapError((error) =>
      Effect.logError('Image operation failed', {
        operation,
        cause: error.cause,
      })
    )
  );

export const measurementsFromImage = Effect.fn('color-extraction.image.measure')(function* (
  bytes: Uint8Array
) {
  const pixels = yield* decodePixels(bytes);
  return {
    measurements: measurePixels(pixels),
    originalSha256: createHash('sha256').update(bytes).digest('hex'),
  };
});

class StoredImageMeasurements implements ImageMeasurements {
  constructor(
    private readonly client: S3Client,
    private readonly nativeWork: Semaphore.Semaphore,
    private readonly bucket: string
  ) {}

  readonly extract = Effect.fn('color-extraction.image.extract')(function* (
    this: StoredImageMeasurements,
    storage: OriginalImage
  ) {
    return yield* this.nativeWork
      .withPermit(
        Effect.gen({ self: this }, function* () {
          const bytes = yield* request('read-image', async (abortSignal) => {
            const location =
              'owner' in storage
                ? resolveOriginalAsset(storage, storage.mimeType, this.bucket)
                : storage;
            const response = await this.client.send(
              new GetObjectCommand({ Bucket: location.bucket, Key: location.key }),
              { abortSignal }
            );
            if (!(response.Body instanceof Readable))
              throw new Error('Object storage returned no readable image');
            const body = response.Body;
            const cancel = () => {
              body.destroy(new Error('Image read interrupted'));
            };
            abortSignal.addEventListener('abort', cancel, { once: true });
            try {
              abortSignal.throwIfAborted();
              if (response.ContentLength !== undefined && response.ContentLength > maxImageBytes) {
                throw new Error('Stored image exceeds 50 MiB');
              }
              let totalBytes = 0;
              const chunks: Buffer[] = [];
              for await (const chunk of body) {
                if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) {
                  throw new Error('Object storage returned invalid image bytes');
                }
                const chunkBytes =
                  typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength;
                if (chunkBytes > maxImageBytes - totalBytes) {
                  throw new Error('Stored image exceeds 50 MiB');
                }
                totalBytes += chunkBytes;
                chunks.push(Buffer.from(chunk));
              }
              return Buffer.concat(chunks, totalBytes);
            } finally {
              abortSignal.removeEventListener('abort', cancel);
              body.destroy();
            }
          });
          return yield* measurementsFromImage(bytes);
        })
      )
      .pipe(
        Effect.timeoutOrElse({
          duration: '100 seconds',
          orElse: () =>
            Effect.fail(
              new ExtractionUnavailable({
                operation: 'extract-image',
                cause: new Error('Image extraction exceeded 100 seconds'),
              })
            ).pipe(
              Effect.tapError((error) =>
                Effect.logError('Image extraction timed out', { cause: error.cause })
              )
            ),
        })
      );
  });
}

export function imageLayer(config: ImageConfig): Layer.Layer<ImageMeasurements | ImageHealth> {
  return Layer.effectContext(
    Effect.gen(function* () {
      const client = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new S3Client({
              endpoint: config.endpoint,
              region: config.region,
              credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
              },
              forcePathStyle: true,
            })
        ),
        (client) => Effect.sync(() => client.destroy())
      );
      const nativeWork = yield* Semaphore.make(1);
      return Context.make(
        ImageMeasurements,
        new StoredImageMeasurements(client, nativeWork, config.bucket)
      ).pipe(
        Context.add(ImageHealth, {
          check: () =>
            request('check-image-storage', (abortSignal) =>
              client.send(new HeadBucketCommand({ Bucket: config.bucket }), { abortSignal })
            ).pipe(
              Effect.timeout('5 seconds'),
              Effect.match({ onSuccess: () => true, onFailure: () => false })
            ),
        })
      );
    })
  );
}
