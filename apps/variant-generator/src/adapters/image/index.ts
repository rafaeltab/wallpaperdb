import { Readable } from 'node:stream';
import {
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Clock, Context, Effect, Layer, Metric, Semaphore } from 'effect';
import { encodeImage } from './process.js';
import {
  GenerationUnavailable,
  VariantImages,
  type GenerationInput,
  type GeneratedVariant,
  type ResolutionPreset,
} from '../../generation/index.js';

export interface ImageConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  readonly jpegQuality: number;
  readonly pngCompressionLevel: number;
  readonly webpQuality: number;
}

export interface ImageHealth {
  check(): Effect.Effect<boolean>;
}
export const ImageHealth = Context.Service<ImageHealth>(
  'wallpaperdb.variant-generator.image.health'
);

// Match the largest image accepted by Ingestor; enforce this independently of S3 metadata.
const maxImageBytes = 50 * 1024 * 1024;

const request = <A>(operation: string, send: (signal: AbortSignal) => Promise<A>) =>
  Effect.tryPromise({
    try: send,
    catch: (cause) => new GenerationUnavailable({ operation, cause }),
  }).pipe(
    Effect.tapError((error) =>
      Effect.logError('Image operation failed', {
        operation,
        cause: error.cause,
      })
    )
  );

class StoredVariantImages implements VariantImages {
  constructor(
    private readonly client: S3Client,
    private readonly nativeWork: Semaphore.Semaphore,
    private readonly config: ImageConfig
  ) {}

  readonly generate = Effect.fn('variant-generation.image.generate')(function* (
    this: StoredVariantImages,
    input: GenerationInput,
    preset: ResolutionPreset
  ): Effect.fn.Return<GeneratedVariant, GenerationUnavailable> {
    return yield* this.nativeWork
      .withPermit(
        Effect.gen({ self: this }, function* () {
          const start = yield* Clock.currentTimeMillis;
          const bytes = yield* request('read-image', async (abortSignal) => {
            const response = await this.client.send(
              new GetObjectCommand({ Bucket: input.storage.bucket, Key: input.storage.key }),
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
          const mimeType = input.mimeType;
          if (mimeType !== 'image/jpeg' && mimeType !== 'image/png' && mimeType !== 'image/webp') {
            return yield* Effect.fail(
              new GenerationUnavailable({
                operation: 'encode-image',
                cause: new Error('Unsupported image format'),
              })
            );
          }
          const output = yield* encodeImage(bytes, {
            ...preset,
            mimeType,
            jpegQuality: this.config.jpegQuality,
            pngCompressionLevel: this.config.pngCompressionLevel,
            webpQuality: this.config.webpQuality,
          });
          const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice(6);
          const storageKey = `${input.wallpaperId}/variant_${preset.width}x${preset.height}.${extension}`;
          yield* request('write-image', (abortSignal) =>
            this.client.send(
              new PutObjectCommand({
                Bucket: input.storage.bucket,
                Key: storageKey,
                Body: output,
                ContentType: mimeType,
              }),
              { abortSignal }
            )
          );
          const end = yield* Clock.currentTimeMillis;
          yield* Metric.update(
            Metric.histogram('variant_generator.single_duration_ms', {
              boundaries: [10, 50, 100, 500, 1000, 5000, 10000, 30000, 60000, 100000],
              attributes: { preset_label: preset.label, format: extension },
            }),
            end - start
          );
          return {
            wallpaperId: input.wallpaperId,
            width: preset.width,
            height: preset.height,
            aspectRatio: preset.width / preset.height,
            format: mimeType,
            fileSizeBytes: output.length,
            storageKey,
            storageBucket: input.storage.bucket,
            createdAt: new Date(input.timestamp),
          } satisfies GeneratedVariant;
        })
      )
      .pipe(
        Effect.timeoutOrElse({
          duration: '100 seconds',
          orElse: () =>
            Effect.fail(
              new GenerationUnavailable({
                operation: 'generate-image',
                cause: new Error('Variant generation exceeded 100 seconds'),
              })
            ).pipe(
              Effect.tapError((error) =>
                Effect.logError('Variant generation timed out', { cause: error.cause })
              )
            ),
        })
      );
  });
}

export function imageLayer(config: ImageConfig): Layer.Layer<VariantImages | ImageHealth> {
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
      return Context.make(VariantImages, new StoredVariantImages(client, nativeWork, config)).pipe(
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
