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
      const scope = yield* Effect.scope;
      const workers = new Set<{ stop(): void; closed: Promise<unknown> }>();
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          const pending = [...workers];
          for (const worker of pending) worker.stop();
          await Promise.all(pending.map((worker) => worker.closed));
        })
      );
      return ImageTransformer.of({
        resize: (body, options) =>
          Effect.gen(function* () {
            if (workers.size >= (limits.maxConcurrent ?? 4)) {
              body.close();
              return yield* Effect.fail(
                new DeliveryUnavailable({
                  operation: 'resize_capacity',
                  cause: new Error('Resize capacity exhausted'),
                })
              );
            }
            const result = yield* Effect.sync(() => {
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
                { stdio: ['pipe', 'pipe', 'pipe'] }
              );
              const input = Readable.from(body);
              const output = new PassThrough();
              output.on('error', () => {});
              const stop = () => {
                body.close();
                input.destroy();
                child.kill('SIGKILL');
              };
              let diagnostic = '';
              let reason = 'worker_failed';
              child.stderr.on('data', (chunk: Buffer) => {
                if (Buffer.byteLength(diagnostic) + chunk.byteLength > 1024) {
                  reason = 'diagnostic_limit';
                  stop();
                } else diagnostic += chunk.toString();
              });
              const closed = new Promise<{
                code: number | null;
                signal: string | null;
                reason: string;
              }>((resolve) => {
                child.once('close', (code, signal) => {
                  clearTimeout(deadline);
                  workers.delete(worker);
                  body.close();
                  if (code === 0) output.end();
                  else {
                    recordCounter('media.resize.pipeline.errors', 1, { error_type: 'Error' });
                    output.destroy(new Error('Image encoding failed'));
                  }
                  const knownReasons = [
                    'unsupported_input',
                    'input_pixel_limit',
                    'corrupt_image',
                    'encoding_failed',
                  ];
                  resolve({
                    code,
                    signal,
                    reason: knownReasons.includes(diagnostic) ? diagnostic : reason,
                  });
                });
              });
              const worker = { stop, closed };
              workers.add(worker);
              const deadline = setTimeout(() => {
                reason = 'deadline_exceeded';
                output.destroy(new Error('Image encoding deadline exceeded'));
                stop();
              }, limits.timeoutMs ?? 30000);
              deadline.unref();
              child.once('error', (error) => {
                reason = 'worker_start_failed';
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
              return { body: byteStream(output), closed, stop };
            });
            yield* Effect.promise(() => result.closed).pipe(
              Effect.onInterrupt(() =>
                Effect.promise(async () => {
                  result.stop();
                  await result.closed;
                })
              ),
              Effect.flatMap((exit) =>
                exit.code === 0
                  ? Effect.void
                  : Effect.fail(new DeliveryUnavailable({ operation: 'resize', cause: exit }))
              ),
              Effect.withSpan('media.resize', {
                attributes: {
                  'resize.width': options.width,
                  'resize.height': options.height,
                  'resize.fit_mode': options.fit,
                  'file.mime_type': options.mimeType,
                },
              }),
              Effect.catchTag('DeliveryUnavailable', (error) =>
                Effect.logError('Media resize failed', {
                  operation: error.operation,
                  diagnostic: error.cause,
                })
              ),
              Effect.forkIn(scope)
            );
            return result.body;
          }).pipe(
            Effect.tapError((error) =>
              Effect.logError('Media resize admission failed', {
                operation: error.operation,
                cause: error.cause,
              })
            )
          ),
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
        }).pipe(
          Effect.tapError((error) =>
            Effect.logError('Profile picture authority failed', { cause: error.cause })
          ),
          Effect.withSpan('media.picture_authority', { attributes: { 'picture.id': id } })
        ),
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
  maxConcurrentReads?: number;
}
export const s3AssetsLayer = (config: S3AssetsConfig) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const streams = new Set<Readable>();
      const requests = new Set<AbortController>();
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
            for (const controller of requests) controller.abort();
            for (const stream of streams) stream.destroy();
            client.destroy();
          })
      );
      const reader: AssetReader = {
        read: (asset, context) =>
          Effect.suspend(() => {
            if (requests.size >= (config.maxConcurrentReads ?? 128))
              return Effect.fail(
                new DeliveryUnavailable({
                  operation: 'storage_capacity',
                  cause: new Error('Storage read capacity exhausted'),
                })
              );
            const controller = new AbortController();
            requests.add(controller);
            const start = Date.now();
            const attributes = {
              'operation.name': 'get_object',
              ...(context ? { source: context.source } : {}),
              ...(context?.fallback ? { fallback: 'true' } : {}),
            };
            return Effect.tryPromise({
              try: async (signal) => {
                let body: Readable | undefined;
                const abort = () => {
                  controller.abort();
                  body?.destroy(new Error('Storage read interrupted'));
                };
                signal.addEventListener('abort', abort, { once: true });
                const deadline = setTimeout(abort, config.readTimeoutMs ?? 30000);
                deadline.unref();
                const release = () => {
                  clearTimeout(deadline);
                  signal.removeEventListener('abort', abort);
                  requests.delete(controller);
                  if (body) streams.delete(body);
                };
                try {
                  signal.throwIfAborted();
                  const response = await client.send(
                    new GetObjectCommand({ Bucket: asset.storageBucket, Key: asset.storageKey }),
                    { abortSignal: controller.signal }
                  );
                  if (!(response.Body instanceof Readable))
                    throw new Error('Storage returned no readable body');
                  body = response.Body;
                  if (controller.signal.aborted) {
                    body.destroy();
                    throw new Error('Storage read interrupted');
                  }
                  streams.add(body);
                  body.once('close', release);
                  body.on('error', () => {});
                  recordCounter('media.s3.operations.total', 1, {
                    ...attributes,
                    'operation.success': 'true',
                  });
                  recordHistogram('media.s3.get_duration_ms', Date.now() - start, attributes);
                  return byteStream(body);
                } catch (cause) {
                  release();
                  recordCounter('media.s3.operations.total', 1, {
                    ...attributes,
                    'operation.success': 'false',
                    'error.type': cause instanceof Error ? cause.name : 'UnknownError',
                  });
                  if (cause instanceof Error && cause.name === 'NoSuchKey') return null;
                  throw cause;
                }
              },
              catch: (cause) => new DeliveryUnavailable({ operation: 'read_asset', cause }),
            });
          }).pipe(
            Effect.tapError((error) =>
              Effect.logError('Media asset read failed', {
                operation: error.operation,
                cause: error.cause,
              })
            ),
            Effect.withSpan('media.s3.get_object', {
              attributes: {
                'storage.bucket': asset.storageBucket,
                'storage.key': asset.storageKey,
              },
            })
          ),
      };
      const health: AssetHealth = {
        check: () =>
          Effect.tryPromise({
            try: (signal) =>
              client.send(new HeadBucketCommand({ Bucket: config.bucket }), {
                abortSignal: AbortSignal.any([
                  signal,
                  AbortSignal.timeout(config.readTimeoutMs ?? 30000),
                ]),
              }),
            catch: (cause) => new DeliveryUnavailable({ operation: 'storage_health', cause }),
          }).pipe(Effect.asVoid),
      };
      return Context.make(AssetReader, reader).pipe(Context.add(AssetHealth, health));
    })
  );
