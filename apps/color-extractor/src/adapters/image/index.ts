import { Readable } from 'node:stream';
import { GetObjectCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Context, Effect, Layer, Semaphore } from 'effect';
import sharp, { type Sharp } from 'sharp';
import {
  computeHistogram,
  ExtractionUnavailable,
  ImageHistogram,
  type OriginalImage,
} from '../../extraction/index.js';

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

/** Sharp cannot cancel native promises. Keep ownership until native work settles. */
function decode<A>(bytes: Uint8Array, run: (image: Sharp) => Promise<A>) {
  return Effect.scoped(
    Effect.gen(function* () {
      const image = yield* Effect.acquireRelease(
        request('decode-image', async () => sharp(bytes).timeout({ seconds: 10 })),
        (image) =>
          Effect.sync(() => {
            image.destroy();
          })
      );
      return yield* request('decode-image', () => run(image)).pipe(Effect.uninterruptible);
    })
  );
}

/** Real image decoding is an adapter operation, independent of storage transport. */
export const histogramFromImage = Effect.fn('color-extraction.image.decode')(function* (
  bytes: Uint8Array
) {
  const metadata = yield* decode(bytes, (image) => image.metadata());
  const aspectRatio = (metadata.width ?? 1) / (metadata.height ?? 1);
  const targetHeight = Math.max(1, Math.round(Math.sqrt(10000 / aspectRatio)));
  const targetWidth = Math.max(1, Math.round(targetHeight * aspectRatio));
  const pixels = yield* decode(bytes, (image) =>
    image.ensureAlpha().resize(targetWidth, targetHeight, { fit: 'fill' }).raw().toBuffer()
  );
  return computeHistogram(pixels);
});

class StoredImageHistogram implements ImageHistogram {
  constructor(
    private readonly client: S3Client,
    private readonly nativeWork: Semaphore.Semaphore
  ) {}

  readonly extract = Effect.fn('color-extraction.image.extract')(function* (
    this: StoredImageHistogram,
    storage: OriginalImage
  ) {
    return yield* this.nativeWork
      .withPermit(
        Effect.gen({ self: this }, function* () {
          const bytes = yield* request('read-image', async (abortSignal) => {
            const response = await this.client.send(
              new GetObjectCommand({ Bucket: storage.bucket, Key: storage.key }),
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
              const chunks: Buffer[] = [];
              for await (const chunk of body) {
                if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) {
                  throw new Error('Object storage returned invalid image bytes');
                }
                chunks.push(Buffer.from(chunk));
              }
              return Buffer.concat(chunks);
            } finally {
              abortSignal.removeEventListener('abort', cancel);
              body.destroy();
            }
          });
          return yield* histogramFromImage(bytes);
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

export function imageLayer(config: ImageConfig): Layer.Layer<ImageHistogram | ImageHealth> {
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
      return Context.make(ImageHistogram, new StoredImageHistogram(client, nativeWork)).pipe(
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
