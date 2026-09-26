import { recordCounter, recordHistogram } from '@wallpaperdb/core/telemetry';
import { GetObjectCommand, HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Readable, PassThrough } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Context, Effect, Layer } from 'effect';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  type AssetBody,
  AssetReader,
  DeliveryUnavailable,
  ImageTransformer,
  PictureAuthority,
} from '../../delivery/index.js';

export const sharpTransformerLayer = (limits: {
  maxInputPixels: number;
  maxConcurrent?: number;
  timeoutMs?: number;
}) =>
  Layer.effect(
    ImageTransformer,
    Effect.gen(function* () {
      const workers = new Set<{ stop(): void; closed: Promise<void> }>();
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          const pending = [...workers];
          for (const worker of pending) worker.stop();
          await Promise.all(pending.map((worker) => worker.closed));
        })
      );
      return ImageTransformer.of({
        resize: (body, options) =>
          Effect.suspend(() => {
            if (workers.size >= (limits.maxConcurrent ?? 4)) {
              body.close();
              return Effect.fail(
                new DeliveryUnavailable({
                  operation: 'resize_capacity',
                  cause: new Error('Resize capacity exhausted'),
                })
              );
            }
            return Effect.sync(() => {
              const start = Date.now();
              const workerPath = new URL(
                import.meta.url.endsWith('.ts') ? './resize-worker.ts' : './resize-worker.mjs',
                import.meta.url
              );
              const child = spawn(
                process.execPath,
                [
                  '--experimental-strip-types',
                  fileURLToPath(workerPath),
                  JSON.stringify({ ...options, maxInputPixels: limits.maxInputPixels }),
                ],
                { stdio: ['pipe', 'pipe', 'ignore'] }
              );
              const input = Readable.from(body);
              const output = new PassThrough();
              output.on('error', () => {});
              const stop = () => {
                body.close();
                input.destroy();
                child.kill('SIGKILL');
              };
              const closed = new Promise<void>((resolve) => {
                child.once('close', (code) => {
                  clearTimeout(deadline);
                  workers.delete(worker);
                  body.close();
                  if (code === 0) output.end();
                  else {
                    recordCounter('media.resize.pipeline.errors', 1, { error_type: 'Error' });
                    output.destroy(new Error('Image encoding failed'));
                  }
                  resolve();
                });
              });
              const worker = { stop, closed };
              workers.add(worker);
              const deadline = setTimeout(() => {
                output.destroy(new Error('Image encoding deadline exceeded'));
                stop();
              }, limits.timeoutMs ?? 30000);
              deadline.unref();
              child.once('error', (error) => {
                output.destroy(error);
                stop();
              });
              output.once('close', stop);
              child.stdout.pipe(output, { end: false });
              void pipeline(input, child.stdin).catch((error) => {
                output.destroy(error);
                stop();
              });
              recordHistogram('media.resize.setup_duration_ms', Date.now() - start, {
                'resize.fit_mode': options.fit,
                'image.format': options.mimeType.split('/')[1],
              });
              return byteStream(output);
            });
          }),
      });
    })
  );

/** Closing before the first read must release the already acquired socket/pipeline, too. */
function byteStream(stream: Readable): AssetBody {
  return {
    close: () => {
      stream.destroy();
    },
    [Symbol.asyncIterator]() {
      const iterator = stream[Symbol.asyncIterator]();
      return {
        async next() {
          const item = await iterator.next();
          if (item.done) return { done: true, value: undefined };
          if (!(item.value instanceof Uint8Array)) {
            stream.destroy();
            throw new Error('Invalid byte stream');
          }
          return { done: false, value: item.value };
        },
        async return() {
          stream.destroy();
          return { done: true, value: undefined };
        },
      };
    },
  };
}

export const pictureAuthorityLayer = (config: {
  origin?: string;
  token?: string;
  timeoutMs?: number;
}) =>
  Layer.succeed(
    PictureAuthority,
    PictureAuthority.of({
      isAvailable: (id) =>
        Effect.tryPromise({
          try: async (signal) => {
            if (!config.origin || !config.token)
              throw new Error('Picture authority is not configured');
            const response = await fetch(
              `${config.origin.replace(/\/+$/, '')}/internal/profile-pictures/${encodeURIComponent(id)}/availability`,
              {
                headers: { Authorization: `Bearer ${config.token}`, 'Cache-Control': 'no-store' },
                redirect: 'error',
                signal: AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs ?? 3000)]),
              }
            );
            await response.body?.cancel();
            if (response.status === 404) return false;
            if (response.status !== 204)
              throw new Error('Picture availability could not be verified');
            return true;
          },
          catch: (cause) => new DeliveryUnavailable({ operation: 'picture_authority', cause }),
        }),
    })
  );

export interface AssetHealth {
  check(): Effect.Effect<void, DeliveryUnavailable>;
}
export const AssetHealth = Context.Service<AssetHealth>('wallpaperdb.media.adapters.AssetHealth');
export interface S3AssetsConfig {
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  readTimeoutMs?: number;
}
export const s3AssetsLayer = (config: S3AssetsConfig) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const streams = new Set<Readable>();
      const client = yield* Effect.acquireRelease(
        Effect.sync(
          () =>
            new S3Client({
              endpoint: config.endpoint,
              region: config.region,
              forcePathStyle: true,
              credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
              },
              maxAttempts: 2,
            })
        ),
        (client) =>
          Effect.sync(() => {
            for (const stream of streams) stream.destroy();
            client.destroy();
          })
      );
      const reader: AssetReader = {
        read: (asset) =>
          Effect.tryPromise({
            try: async (signal) => {
              const response = await client.send(
                new GetObjectCommand({ Bucket: asset.storageBucket, Key: asset.storageKey }),
                { abortSignal: signal }
              );
              if (!(response.Body instanceof Readable))
                throw new Error('Storage returned no readable body');
              const body = response.Body;
              streams.add(body);
              const deadline = setTimeout(
                () => body.destroy(new Error('Storage read deadline exceeded')),
                config.readTimeoutMs ?? 30000
              );
              deadline.unref();
              body.once('close', () => {
                clearTimeout(deadline);
                streams.delete(body);
              });
              body.on('error', () => {});
              return byteStream(body);
            },
            catch: (cause) => new DeliveryUnavailable({ operation: 'read_asset', cause }),
          }).pipe(
            Effect.catchTag('DeliveryUnavailable', (failure) => {
              const cause = failure.cause;
              if (cause instanceof Error && cause.name === 'NoSuchKey') return Effect.succeed(null);
              return Effect.fail(failure);
            })
          ),
      };
      const health: AssetHealth = {
        check: () =>
          Effect.tryPromise({
            try: (signal) =>
              client.send(new HeadBucketCommand({ Bucket: config.bucket }), {
                abortSignal: signal,
              }),
            catch: (cause) => new DeliveryUnavailable({ operation: 'storage_health', cause }),
          }).pipe(Effect.asVoid),
      };
      return Context.make(AssetReader, reader).pipe(Context.add(AssetHealth, health));
    })
  );
